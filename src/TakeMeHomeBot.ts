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
import { GTFSRepositoryModel, IGTFSRepositoryModel, IRepoRESTDataModel } from './models/GTFSRepositoryModel';
import { Model, disconnect } from 'mongoose';
import { reject, select } from 'async';
import { IGTFSDataModel, GTFSDataModel } from './models/GTFSDataModel';
import { ResponseMessage } from './models/ResponseMessage';

export class TakeMeHomeBot {
    private telebot: TeleBot;
    private db: mongoose.Connection;
    private configModel: Model<IConfigModel>;
    private gtfsDataModel: Model<IGTFSDataModel>;
    private gtfsRepositoryModel: Model<IGTFSRepositoryModel>;

    constructor() {
        process.on('SIGINT', () => {
            this.disconnectDB();
        });
        process.on('SIGTERM', () => {
            this.disconnectDB();
        });
        (<any>mongoose).Promise = global.Promise;
        mongoose.connect(Config.MONGODB_URI, { useMongoClient: true })
            .then(() => this.logInfo(`Connected on ${Config.MONGODB_URI}`))
            .catch(err => this.logErr(`Cannot connect on ${Config.MONGODB_URI}`));
        mongoose.connection.on('connected', () => {
            this.logInfo(`Mongoose connection open on:${Config.MONGODB_URI}`);
        });
        mongoose.connection.on('error', (err) => {
            this.logErr(err);
        });
        mongoose.connection.on('disconnected', () => {
            this.logInfo('Mongoose disconnected.');
        });
        this.configModel = new ConfigModel().model();
        this.gtfsDataModel = new GTFSDataModel().model();
        this.gtfsRepositoryModel = new GTFSRepositoryModel().model();
    }

    private disconnectDB(): void {
        const self: TakeMeHomeBot = this;
        mongoose.connection.close((err) => {
            if (err) {
                self.logErr(err);
            } else
                self.logInfo('Mongoose default connection disconnected through app termination.');
            process.exit(0);
        });
    }

    private getConfiguration(): Promise<TeleBot.config> {
        return new Promise<TeleBot.config>(
            (p_resolve, p_reject) => {
                this.configModel.findOne({})
                    .then(res => {
                        if (!res) {
                            this.logInfo(`No config found. let's create new default one.`);
                            let new_config = new this.configModel({ token: Config.DefaultConfig.token })
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

    private async CmdStart(msg: any): Promise<void> {
        if (!msg) {
            this.logInfo(`msg is invalid.`);
            return;
        }
        const id = this.getMsgId(msg);
        const self: TakeMeHomeBot = this;
        this.telebot.sendMessage(id, `
            Hello ${this.getUserName(msg)}.
If you send me your location I show you the buses arrivals and times stops nearby you.
This is a list of active repositories:
${await this.getRepositoriesActiveList().catch(err => self.logErr(err))}
`);
    }

    private isValidMsgLocationEvent(msg): boolean {
        if (!msg
            || !msg.location
            || !msg.location.latitude
            || !msg.location.longitude)
            return false;
        return true;
    }

    private ManageLocationEvent(msg): void {
        if (this.isValidMsgLocationEvent(msg)) {
            const geoJSON = {
                type: 'Point',
                coordinates: [msg.location.latitude, msg.location.longitude]
            }
            this.gtfsDataModel.geoNear(geoJSON, { maxDistance: 500, spherical: true, lean: true },
                (err, results, stats) => {
                    if (err) {
                        this.logErr(err);
                        return;
                    }
                    async.forEach<any, Error>(results,
                        async (stopItem, next) => {
                            const response: ResponseMessage = new ResponseMessage(stopItem.obj.stop_id,
                                stopItem.obj.stop_name,
                                stopItem.obj.stop_desc ? stopItem.obj.stop_desc : '');
                            await this.checkWaitingTime(stopItem.obj, response);
                            this.telebot.sendMessage(this.getMsgId(msg), response.message)
                                .then(() => { next(); })
                                .catch(err => { this.logErr(err); next(); });
                        },
                        err => {
                            this.logInfo(`query complete for ${this.getUserName(msg)}.`);
                        });
                }
            );
        } else {
            this.logErr(`Invalid location message event.`);
        }
    }

    private checkWaitingTime(stopItem: IGTFSDataModel, responseMsg: ResponseMessage): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!stopItem) {
                reject(new Error(`stopItem is invalid.`));
                return;
            }
            if (!stopItem.repo_data) {
                reject(new Error(`repo_data is invalid.`));
                return;
            }
            const url: string = this.getREPOUrl(stopItem.repo_data);
            if (!url) {
                reject(new Error(`url is invalid.`));
                return;
            }

            Axios.default({
                method: (stopItem.repo_data.type) ? stopItem.repo_data.type : 'get',
                url: url,
                responseType: 'json',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                data: this.getParams(stopItem)
            })
                .then(response => {
                    if (response
                        && response.data
                        && response.data.risposta) {
                        let waiting_time: string = '';
                        if (Array.isArray(response.data.risposta.arrivi)) {
                            async.forEach<any, Error>(response.data.risposta.arrivi, (r_item, next) => {
                                if (r_item.linea
                                    && r_item.annuncio
                                    && r_item.capolinea
                                ) responseMsg.addWaitingData(r_item.linea, r_item.capolinea, r_item.annuncio);
                                next();
                            },
                                err => {
                                    resolve();
                                });
                        }
                    }
                })
                .catch(err => reject(err));
        });
    }

    private getParams(stopItem: IGTFSDataModel): string {
        let searchParams: string = '';
        if (!stopItem) {
            this.logErr(`stopItem is not defined or invalid.`);
            return searchParams;
        }
        if (!stopItem.repo_data) {
            this.logErr(`repo_data is not defined or invalid.`);
            return searchParams;
        }
        if (!stopItem.repo_data.parameters) {
            this.logErr(`parameters is not defined or invalid.`);
            return searchParams;
        }
        for (const item of stopItem.repo_data.parameters) {
            if (item.type === 'stop_id') {
                searchParams = searchParams.concat(`${item.name}=${stopItem.stop_id}`);
            } else {
                searchParams = searchParams.concat(`${item.name}=${item.value}`);
            }
        }
        return searchParams;
    }

    private getREPOUrl(repo_data: IRepoRESTDataModel): string {
        if (!repo_data.endpoint)
            return '';
        return `${repo_data.endpoint}${(repo_data.method) ? repo_data.method : ''}`;
    }

    private getRepositoriesActiveList(): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            this.gtfsRepositoryModel.find({ isActive: true }, 'name')
                .then((repoItems: IGTFSRepositoryModel[]) => {
                    const repoNameArr: Array<string> = [];
                    async.forEach(
                        repoItems,
                        (item, next) => {
                            repoNameArr.push(item.name);
                            next();
                        },
                        err => {
                            if (err) {
                                reject(err);
                                return;
                            }
                            resolve(repoNameArr.join(', '));
                        }
                    );
                }).catch(err => {
                    this.logErr(err);
                    reject(err);
                });
        });
    }

    private getUserName(msg: any): string {
        if (!msg && !msg.from)
            return '(not found)';
        return (msg.from.username) ? `@${msg.from.username}` : `@id:${msg.from.id}`;
    };

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

    private sendMessage(msg: any, text: string): void {
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
        this.telebot.on('location', (msg) => this.ManageLocationEvent(msg));
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
                                reject(err);
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
                                    reject(err);
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
                    err => global_rejected(err)
                    );
            }
        );
    }

    private saveGtfsFileZip(fullPath: string, data: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (!fullPath) {
                reject(new Error(`fullPath is invalid.`));
                return;
            }
            fs.writeFile(fullPath, data,
                (err: NodeJS.ErrnoException) => {
                    if (err) {
                        this.logErr(err);
                        reject(err);
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
                                entry.pipe(fs.createWriteStream(outputPath));
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
                        const gtfsDataDoc = new this.gtfsDataModel({
                            stop_id: gtfsItem.stop_id,
                            stop_name: gtfsItem.stop_name,
                            location: {
                                type: 'Point',
                                coordinates: [gtfsItem.stop_lat, gtfsItem.stop_lon]
                            },
                            referenceId: gtfsDoc._id,
                            stop_desc: gtfsItem.stop_desc ? gtfsItem.stop_desc : '',
                            repo_data: gtfsDoc.repo_data
                        });
                        gtfsDataDoc.save()
                            .then(() => { ++imported_count; next(); })
                            .catch(err => { this.logErr(err); next(); });
                    } else {
                        this.logInfo(`Invalid gtfs item found. Skip.`);
                    }
                },
                (err) => {
                    this.logInfo(`Imported ${imported_count} doc[ s ].`);
                    resolve();
                });
        });
    }

    private updateHash(gtfsDoc: IGTFSRepositoryModel, fileHash: string): Promise<void> {
        return new Promise<void>(
            (resolve, reject) => {
                gtfsDoc.model('GTFSRepository').findOneAndUpdate(
                    { _id: gtfsDoc._id },
                    { hash: fileHash, lastUpdate: new Date() },
                    (err, doc) => {
                        if (err) {
                            this.logErr(err);
                            reject(err);
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

                        await this.createPathIfNotExist(parsedPath.base).catch(() => this.logErr(`Cannot create path.`));
                        await this.saveGtfsFileZip(fullPath, response.data).catch(() => this.logErr(`Cannot save GTFS zip.`));
                        this.logInfo(`getting hash for ${parsedPath.base} file.`);
                        const fileHash = await hash_file(fullPath).catch((err) => { this.logErr(err); return null; });
                        if (fileHash === null) {
                            this.logErr(`hash is null. Something went wrong.`);
                            resolve();
                            return;
                        }
                        if (fileHash === gtfsDoc.hash) {
                            this.logInfo(`No update needed for ${gtfsDoc.name}`);
                            await this.updateHash(gtfsDoc, fileHash).catch(() => this.logErr(`Cannot update hash.`));
                            resolve();
                            return;
                        }
                        this.logInfo(`Hashes differ, update needed for ${gtfsDoc.name}`);
                        await this.removeExistingData(gtfsDoc._id).catch((err) => this.logErr(err));

                        const result = await this.extractSTOPSCsv(fullPath).catch(() => this.logErr(`Cannot read CSV Data.`));
                        if (!result) {
                            this.logInfo(`No stops.txt file found.`);
                            resolve();
                            return;
                        }
                        else {
                            const gtfsDataArr = await this.parseCSVData(stopsFile).catch((err) => null);
                            if (gtfsDataArr === null) {
                                this.logErr(`gtfsDataArr is invalid. Something went wrong.`);
                                resolve();
                                return;
                            }
                            await this.importData(gtfsDataArr, gtfsDoc).catch(() => this.logErr(`Cannot import data.`));
                            await this.updateHash(gtfsDoc, fileHash).catch(() => this.logErr(`Cannot update hash.`));
                            this.logInfo(`Cleanup files for ${gtfsDoc.name}`);
                            const self: TakeMeHomeBot = this;
                            fs.unlink(fullPath, (err: NodeJS.ErrnoException) => {
                                if (err)
                                    self.logErr(err);
                            });
                            fs.unlink(stopsFile, (err: NodeJS.ErrnoException) => {
                                if (err)
                                    self.logErr(err);
                            });
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

    private removeExistingData(referenceId: any): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.logInfo(`removing existing data.`);
            let removed_count: number = 0;
            if (!referenceId) {
                reject(new Error(`reference id is invalid.`));
                return;
            }
            const self: TakeMeHomeBot = this;
            this.gtfsDataModel.find({ 'referenceId': referenceId },
                (err, res) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    async.forEach<IGTFSDataModel, Error>(res,
                        (item, next) => {
                            item.remove().then(() => { ++removed_count; next(); })
                                .catch(err => { self.logErr(err); next(); });
                        },
                        err => {
                            this.logInfo(`${removed_count} item[s] removed.`);
                            resolve();
                        });
                });
        });
    }

    private loadGTFSDatasets(): void {
        this.gtfsRepositoryModel.find({ isActive: true })
            .then((repoItems: IGTFSRepositoryModel[]) => {
                this.logInfo(`${repoItems.length} repositor[ y | ies ] found.`);
                async.forEach<IGTFSRepositoryModel, Error>(repoItems, (gtfsItem, next) => {
                    if (!moment(gtfsItem.lastUpdate).isValid()
                        || moment(gtfsItem.lastUpdate).startOf('day')
                            .isBefore(moment().days(Config.UPDATE_DAY_AFTER).startOf('day'))) {
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
        const self: TakeMeHomeBot = this;
        this.logInfo(`Starting ${Config.BOT_NAME}[PID:${process.pid}]...`);
        const config: TeleBot.config = await this.getConfiguration()
            .catch((reason) => { self.logErr(reason); return null; });
        if (!config)
            throw new Error('No configuration found.');
        try {
            this.logInfo(`loading/updating GTFS Datasets.`);
            this.loadGTFSDatasets();
            this.telebot = new TeleBot(config);
            this.initBotCommand();
            this.telebot.start();
        }
        catch (err) {
            this.logErr(err.message);
            this.disconnectDB();
        }
    }
}