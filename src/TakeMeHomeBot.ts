import * as TeleBot from 'telebot';
import * as moment from 'moment';
import * as async from 'async';
import * as Axios from 'axios';
import { Config } from './Config';
import { request } from 'https';
import * as path from 'path';
import { ParsedPath, resolve } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as hash_file from 'hash-file';
import * as mongoose from 'mongoose';
import { Connection, Document, Schema, Model, model, mongo } from "mongoose";
import { ConfigModel, IConfigModel } from './models/ConfigModel';
import { GTFSRepositoryModel, IGTFSRepositoryModel } from './models/GTFSRepositoryModel';

export class TakeMeHomeBot {
    private telebot: TeleBot;
    private db: mongoose.Connection;
    private config: Model<IConfigModel>;

    constructor() {
        process.on('SIGINT', () => {
            mongoose.connection.close(() => {
                console.log('Mongoose default connection disconnected through app termination.');
                process.exit(0);
            });
        });
        (<any>mongoose).Promise = global.Promise;
        mongoose.connect(Config.MONGODB_URI, { useMongoClient: true });
        mongoose.connection.on('connected', () => {
            this.logInfo(`Mongoose connection open on:${Config.MONGODB_URI}`);
        });
        mongoose.connection.on('error', (err) => {
            this.logErr(err);
        });
        mongoose.connection.on('disconnected', () => {
            this.logInfo('Mongoose disconnected.');
        });
        this.config = new ConfigModel().model();
    }

    private getConfiguration(): Promise<TeleBot.config> {
        return new Promise<TeleBot.config>(
            (p_resolve, p_reject) => {
                this.config.findOne({})
                    .then(res => {
                        if (!res) {
                            this.logInfo(`No config found. let's create new default one.`);
                            let new_config = new this.config({ token: Config.DefaultConfig.token })
                            new_config.save();
                            p_resolve(new_config);
                            return;
                        }
                        p_resolve({
                            token: res.token
                        });
                    }, reject => {
                        p_reject(reject);
                    });
            }
        );
    }

    private getTimeStamp(): string {
        return moment().format('DD/MM/YYYY HH:mm');
    }

    private logErr(mex: string | Error): void {
        if (mex instanceof Error) {
            console.error(`[${this.getTimeStamp()}] ${mex.message}`);
        } else {
            console.error(`[${this.getTimeStamp()}] ${mex}`);
        }
    }

    private logInfo(mex: string): void {
        console.log(`[${this.getTimeStamp()}] ${mex}`);
    }

    private getMsgId(msg: any): number {
        if (!msg)
            throw new Error('Msg is invalid.');
        if (this.isFromGroup(msg))
            return msg.chat.id;
        else
            return msg.from.id;
    }

    private CmdStart(msg: any): void {
        if (!msg) {
            this.logInfo(`msg is invalid.`);
            return;
        }
        let id = this.getMsgId(msg);
        this.telebot.sendMessage(id, 'TEST');
    }

    private isFromGroup(msg: any): boolean {
        if (msg
            && msg.chat
            && msg.chat.type
            && (msg.chat.type === 'group'
                || msg.chat.type === 'supergroup'
                || msg.chat.type === 'channel')
        ) return true;
        return false;
    }

    private sendMessage(msg: any, text: string) {
        let id = -1;
        if (!msg && !msg.chat && !msg.chat.type) {
            this.logInfo(`msg is invalid.`);
            return;
        }

        if (this.isFromGroup(msg)) {
            id = msg.chat.id;
        }
        else {
            id = msg.from.id;
        }

        this.telebot.sendMessage(id, text)
            .catch(err => this.logErr(err));
    };

    private initBotCommand(): void {
        if (!this.telebot)
            throw new Error('No Telebot instance.');
        this.telebot.on('/start', (msg) => this.CmdStart(msg));
    }

    private createPathIfNotExist(fileName: string): Promise<void> {
        return new Promise<void>(
            (global_resolver, global_rejected) => {
                Promise.all<void>([
                    /* first create the TMP dir. */
                    new Promise<void>((resolve, reject) => {
                        fs.mkdir(os.tmpdir + path.sep + Config.TMP_DIR_NAME, (err: NodeJS.ErrnoException) => {
                            if (err) {
                                if (err.code === 'EEXIST') {
                                    resolve();
                                    return;
                                }
                                this.logErr(err);
                                reject();
                                return;
                            }
                            resolve();
                        });
                    }),
                    /* second create the container dir. */
                    new Promise<void>((resolve, reject) => {
                        fs.mkdir(os.tmpdir + path.sep + Config.TMP_DIR_NAME + path.sep + fileName,
                            (err: NodeJS.ErrnoException) => {
                                if (err) {
                                    if (err.code === 'EEXIST') {
                                        resolve();
                                        return;
                                    }
                                    this.logErr(err);
                                    reject();
                                    return;
                                }
                                resolve();
                            });
                    })
                ])
                    .then(
                    all => global_resolver()
                    )
                    .catch(
                    err => global_rejected()
                    );
            }
        );
    }

    private saveGtfsFileZip(fileName: string, data: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!fileName) {
                reject();
                return;
            }
            fs.writeFile(os.tmpdir + path.sep
                + Config.TMP_DIR_NAME + path.sep
                + fileName + path.sep
                + fileName, data,
                (err: NodeJS.ErrnoException) => {
                    if (err) {
                        this.logErr(err);
                        reject();
                        return;
                    }
                    resolve();
                });
        });
    }

    private updateGTFSData(gtfsDoc: IGTFSRepositoryModel): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!gtfsDoc.repositoryUrl) {
                resolve();
                return;
            }
            this.logInfo(`Getting ${gtfsDoc.name} from ${gtfsDoc.repositoryUrl}.`);
            Axios.default.get(gtfsDoc.repositoryUrl)
                .then(async response => {
                    if (response.status === 200
                        && response.headers['content-type'] === 'application/zip'
                    ) {
                        this.logInfo(`${gtfsDoc.name} downloaded.`);
                        let parsedPath: ParsedPath = path.parse(response.request.path);
                        if (!parsedPath.base) {
                            resolve();
                            return;
                        }
                        try {
                            await this.createPathIfNotExist(parsedPath.base);
                            await this.saveGtfsFileZip(parsedPath.base, response.data);
                            let fileHash = await hash_file(os.tmpdir + path.sep
                                + Config.TMP_DIR_NAME + path.sep
                                + parsedPath.base + path.sep
                                + parsedPath.base);
                            if (fileHash === gtfsDoc.hash) {
                                this.logInfo(`No update needed for ${gtfsDoc.name}`);
                                resolve();
                                return;
                            }
                            this.logInfo(`Update needed for ${gtfsDoc.name}`);
                            /* TODO */
                            resolve();
                        }
                        catch (err) {
                            this.logErr(err);
                            resolve();
                        }
                    } else {
                        this.logErr(response.statusText);
                        resolve();
                    }
                })
                .catch(err => { this.logErr(err); resolve(); });
        });
    }

    private loadGTFSDatasets(): void {
        let GTFSRepository = new GTFSRepositoryModel().model();
        GTFSRepository.find({ isActive: true })
            .then((repoItems: IGTFSRepositoryModel[]) => {
                this.logInfo(`${repoItems.length} repositor[ y | ies] found.`);
                async.forEach<IGTFSRepositoryModel, Error>(repoItems, (gtfsItem, next) => {
                    if (!moment(gtfsItem.lastUpdate).isValid()
                        || moment(gtfsItem.lastUpdate)
                            .isAfter(moment().days(Config.UPDATE_DAY_AFTER))) {
                        this.updateGTFSData(gtfsItem).then(() => {
                            next();
                        });
                    }
                }, err => {
                    if (err) {
                        this.logErr(err);
                        return;
                    }
                    this.logInfo(`Repositories updating: done.`);
                });
            },
            (reject) => {
                this.logErr(reject);
                return;
            });
    }

    async init() {
        this.logInfo(`Starting ${Config.BOT_NAME}[PID:${process.pid}]...`);

        let config: TeleBot.config = await this.getConfiguration()
            .catch((reason) => { console.log(reason); return null; });
        if (!config)
            throw new Error('No configuration found.');
        try {
            this.logInfo(`Starting ${Config.BOT_NAME}...`);
            this.telebot = new TeleBot(config);
            this.initBotCommand();
            this.logInfo(`loading/updating GTFS Datasets.`);
            this.loadGTFSDatasets();
            //this.telebot.start();
        }
        catch (err) {
            this.logErr(err.message);
            process.exit(err);
        }
    }
}