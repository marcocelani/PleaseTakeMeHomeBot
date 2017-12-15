import * as TeleBot from 'telebot';
import * as moment from 'moment';
import * as async from 'async';
import * as Axios from 'axios';
import { Config } from './Config';
import { MongoClient, Db, MongoError, Collection, Cursor, MongoCallback } from 'mongodb';
import { GTFSRepository } from './GTFSRepository';
import { request } from 'https';
import * as path from 'path';
import { ParsedPath } from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as hash_file from 'hash-file';

export class TakeMeHomeBot {
    private telebot: TeleBot;
    private db: Db | null;

    private initMongoInstance(): Promise<Db> {
        return new Promise<Db>((resolve, reject) => {
            if (!Config.MONGODB_URI) {
                reject(new Error('No URI for MongoDB.'));
            }
            MongoClient.connect(Config.MONGODB_URI, (err: MongoError, db: Db) => {
                if (err) {
                    reject(err);
                    return;
                }
                resolve(db);
            })
        });
    }

    private getConfiguration(): Promise<TeleBot.config> {
        return new Promise<TeleBot.config>(async (resolve, reject) => {
            if (!this.db) {
                this.db = await this.initMongoInstance()
                    .catch((reason) => { this.logErr(reason); return null; });
                if (!this.db) {
                    reject(new Error('No DB.'));
                    return;
                }
            }
            this.db.collection(Config.MONGODB_CONFIG_COLL,
                async (err: MongoError, coll: Collection<TeleBot.config>) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(await this.findConfiguration(coll));
                });
        });
    }

    private findConfiguration(coll: Collection<TeleBot.config>): Promise<TeleBot.config> {
        return new Promise<TeleBot.config>(async (resolve, reject) => {
            if (!coll) {
                reject(new Error('No coll defined.'));
                return;
            }
            let config: TeleBot.config | null
                = await coll.findOne<TeleBot.config>({})
                    .catch((reason) => {
                        this.logErr(reason);
                        return null;
                    });
            if (!config)
                config = Config.DefaultConfig;
            resolve(config);
        });
    }

    private getDefaultConfig(): TeleBot.config {
        return null;
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
                            (err : NodeJS.ErrnoException) => {
                            if(err){
                                if(err.code === 'EEXIST'){
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
            fs.writeFile(os.tmpdir + '\\' + Config.TMP_DIR_NAME + '\\' + fileName + '\\' + fileName, data, 
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

    private updateGTFSData(gtfsDoc: GTFSRepository): void {
        if (!gtfsDoc.repositoryUrl)
            return;
        Axios.default.get(gtfsDoc.repositoryUrl)
            .then(async response => {
                if (response.status === 200
                    && response.headers['content-type'] === 'application/zip'
                ) {
                    let parsedPath: ParsedPath = path.parse(response.request.path);
                    if (!parsedPath.base)
                        return;
                    try {
                        await this.createPathIfNotExist(parsedPath.base);
                        await this.saveGtfsFileZip(parsedPath.base, response.data);
                        let fileHash = await hash_file(os.tmpdir + '\\' + Config.TMP_DIR_NAME + '\\' + parsedPath.base + '\\' + parsedPath.base);
                        if (fileHash === gtfsDoc.dataHash) {
                            this.logInfo(`No update needed for ${gtfsDoc.city}`);
                            return;
                        }
                        this.logInfo(`Update needed for ${gtfsDoc.city}`);
                        /* TODO */
                    }
                    catch (err) {
                        this.logErr(err);
                    }
                } else {
                    this.logErr(response.statusText);
                }
            })
    }

    private loadGTFSDatasets(): void {
        let gtfsDataArr: Array<GTFSRepository>;
        new Promise<Array<GTFSRepository>>((resolve, reject) => {
            this.db.collection<GTFSRepository>(Config.MONGODB_GTFS_COLL,
                (err: MongoError, coll: Collection<GTFSRepository>) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    resolve(coll.find<GTFSRepository>({ isActive: true }).toArray());
                });
        })
            .then(gtfsDocs => {
                async.forEach<GTFSRepository, Error>(gtfsDocs, gtfsItem => {
                    if (!moment.isMoment(gtfsItem.lastUpdate)
                        || moment(gtfsItem.lastUpdate).isAfter(moment().days(Config.UPDATE_DAY_AFTER))) {
                        this.updateGTFSData(gtfsItem);
                    }
                }, (err) => {
                    if (err) {
                        throw new Error('Something went wrong.');
                    }
                    this.logInfo('TEST.');
                });
            })
            .catch(err => this.logErr(err));
    }

    async init() {
        this.logInfo(`Starting ${Config.BOT_NAME}...`);
        this.db = await this.initMongoInstance()
            .catch((reason) => { console.log(reason); return null; });
        if (!this.db)
            throw new Error('No DB.');

        let config: TeleBot.config = await this.getConfiguration()
            .catch((reason) => { console.log(reason); return null; });
        try {
            this.logInfo(``);
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