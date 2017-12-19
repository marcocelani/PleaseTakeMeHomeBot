import * as TeleBot from 'telebot';
import * as moment from 'moment';
import * as async from 'async';
import * as Axios from 'axios';
import * as fs from 'fs';
import * as os from 'os';
import * as hash_file from 'hash-file';
import * as mongoose from 'mongoose';
import * as path from 'path';
import * as unzip from 'unzip';
import * as csvParser from 'csv-parse';
import { Config } from './Config';
import { ParsedPath, resolve, parse } from 'path';
import { ConfigModel, IConfigModel } from './models/ConfigModel';
import { GTFSRepositoryModel, IGTFSRepositoryModel } from './models/GTFSRepositoryModel';
import { Model } from 'mongoose';
import { reject } from 'async';
import { IGTFSDataModel, GTFSDataModel } from './models/GTFSDataModel';

export class TakeMeHomeBot {
    private telebot: TeleBot;
    private db: mongoose.Connection;
    private config: Model<IConfigModel>;
    private gtfsDataModel: Model<IGTFSDataModel>;

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
        this.gtfsDataModel = new GTFSDataModel().model();
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

    private saveGtfsFileZip(fullPath: string, data: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!fullPath) {
                reject();
                return;
            }
            fs.writeFile(fullPath, data,
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

    private extractSTOPSCsv(zipFilePath: string): Promise<boolean> {
        return new Promise<boolean>(
            (resolve) => {
                if (!zipFilePath) {
                    this.logErr(`No zip file specified.`);
                    resolve(false);
                    return;
                }
                const outputPath = path.parse(zipFilePath).dir + path.sep + 'stops.txt';
                this.logInfo(`Extracting STOPS information[${zipFilePath}].`);
                try {
                    fs.createReadStream(zipFilePath)
                        .pipe(unzip.Parse())
                        .on('entry', (entry) => {
                            var fileName = entry.path;
                            var type = entry.type;
                            if (entry.type === 'File'
                                && fileName === 'stops.txt') {
                                entry.pipe(fs.createWriteStream(outputPath, { autoClose: true }));
                                entry.autodrain();
                                this.logInfo(`stops.txt extracted[${zipFilePath}].`);
                            } else {
                                entry.autodrain();
                            }
                        })
                        .on('error', (err) => {
                            this.logErr(err);
                            resolve(false);
                        }).on('close', () => {
                            resolve(true);
                        });
                }
                catch (err) {
                    this.logErr(err);
                    resolve(false);
                }
            }
        );
    }

    private parseCSVData(stopsFile: string): Promise<Array<any>> {
        return new Promise<Array<any>>(
            (resolve, reject) => {
                this.logInfo(`Parsing csv file[${stopsFile}].`);
                const parser = csvParser(
                    {
                        delimiter: ',',
                        columns: true,
                        trim: true,
                        skip_empty_lines: true,
                        relax_column_count: true
                    },
                    (err, data) => {
                        if (err) {
                            this.logErr(err);
                            reject(err);
                            return;
                        }
                        this.logInfo(`Csv file[${stopsFile}] parsed.`);
                        resolve(data);
                    });
                fs.createReadStream(stopsFile, { autoClose: true }).pipe(parser);
            }
        );
    }

    private checkGTFSItem(gtfsItem: any): boolean {
        if (!gtfsItem
            || !gtfsItem['stop_id']
            || !gtfsItem['stop_name']
            || !gtfsItem['stop_lat']
            || !gtfsItem['stop_lon'])
            return false;
        return true;
    }

    private importData(dataArr: Array<any>, gtfsDoc: IGTFSRepositoryModel): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.logInfo(`Importing data for ${gtfsDoc.name}`);
            let imported_count: number = 0;
            async.forEach<any, Error>(dataArr,
                (gtfsItem, next) => {
                    if (this.checkGTFSItem(gtfsItem)) {
                        try {
                            const gtfsDataDoc = new this.gtfsDataModel({
                                stop_id: gtfsItem.stop_id,
                                stop_name: gtfsItem.stop_name,
                                location: {
                                    type: 'Point',
                                    coordinates: [gtfsItem.stop_lat, gtfsItem.stop_lon]
                                },
                                referenceId: gtfsDoc._id
                            });
                            gtfsDataDoc.save();
                            imported_count++;
                        } catch (err) {
                            this.logErr(err);
                        }
                    } else {
                        this.logInfo(`Invalid gtfs item found. Skip.`);
                    }
                    next();
                },
                (err) => {
                    if (err) {
                        this.logErr(err);
                        return;
                    }
                    this.logInfo(`Imported ${imported_count} doc[ s ].`);
                    resolve();
                });
        });
    }

    updateHash(gtfsDoc: IGTFSRepositoryModel, fileHash: string): Promise<void> {
        return new Promise<void>(
            (resolve, reject) => {
                gtfsDoc.model('GTFSRepository').findOneAndUpdate(
                    { _id: gtfsDoc._id },
                    { hash: fileHash, lastUpdate: new Date() },
                    (err, doc) => {
                        if(err){
                            this.logErr(err);
                            reject();
                        }
                        this.logInfo(`${gtfsDoc.name} repository hash updated.`);
                        resolve();
                    }
                );
            });
    }

    private updateGTFSData(gtfsDoc: IGTFSRepositoryModel): Promise<void> {
        return new Promise<void>((resolve) => {
            if (!gtfsDoc.repositoryUrl) {
                resolve();
                return;
            }
            this.logInfo(`Getting ${gtfsDoc.name} from ${gtfsDoc.repositoryUrl}.`);
            Axios.default.get(gtfsDoc.repositoryUrl, { responseType: 'arraybuffer' })
                .then(async response => {
                    if (response.status === 200
                        && response.headers['content-type'].includes('application/zip')
                    ) {
                        this.logInfo(`${gtfsDoc.name} downloaded.`);
                        const parsedPath: ParsedPath = path.parse(response.request.path);
                        if (!parsedPath.base) {
                            resolve();
                            return;
                        }
                        const fullPath: string = os.tmpdir + path.sep
                            + Config.TMP_DIR_NAME + path.sep
                            + parsedPath.base + path.sep
                            + parsedPath.base;
                        const stopsFile: string = os.tmpdir + path.sep
                            + Config.TMP_DIR_NAME + path.sep
                            + parsedPath.base + path.sep
                            + 'stops.txt';
                        try {
                            await this.createPathIfNotExist(parsedPath.base).catch((err) => { throw err; });
                            await this.saveGtfsFileZip(fullPath, response.data).catch((err) => { throw err; });
                            this.logInfo(`getting hash for ${parsedPath.base} file.`);
                            let fileHash = await hash_file(fullPath).catch((err) => { throw err; });
                            if (fileHash === gtfsDoc.hash) {
                                this.logInfo(`No update needed for ${gtfsDoc.name}`);
                                resolve();
                                return;
                            }
                            this.logInfo(`Hashes differ, update needed for ${gtfsDoc.name}`);
                            const result = await this.extractSTOPSCsv(fullPath).catch((err) => { throw err; });
                            if (!result) {
                                this.logInfo(`No stops.txt file found.`);
                                resolve();
                                return;
                            }
                            else {
                                const gtfsDataArr = await this.parseCSVData(stopsFile).catch((err) => { throw err; });
                                await this.importData(gtfsDataArr, gtfsDoc).catch((err) => { throw err; });
                                await this.updateHash(gtfsDoc, fileHash).catch((err) => { throw err; });
                                resolve();
                            }
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
        const GTFSRepository = new GTFSRepositoryModel().model();
        GTFSRepository.find({ isActive: true })
            .then((repoItems: IGTFSRepositoryModel[]) => {
                this.logInfo(`${repoItems.length} repositor[ y | ies ] found.`);
                async.forEach<IGTFSRepositoryModel, Error>(repoItems, (gtfsItem, next) => {
                    if (!moment(gtfsItem.lastUpdate).isValid()
                        || moment(gtfsItem.lastUpdate)
                            .isAfter(moment().days(Config.UPDATE_DAY_AFTER))) {
                        this.updateGTFSData(gtfsItem).then(() => {
                            next();
                        });
                    } else {
                        this.logInfo(`No update needed for ${gtfsItem.name}.`);
                        next();
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