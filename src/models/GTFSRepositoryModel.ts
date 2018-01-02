import * as mongoose from 'mongoose';
import { Schema, Document, Model, Connection } from 'mongoose';
import { IPTMHMModel } from './IPTMHModel';
import { Config } from '../Config';
import { RepoRestParamSchema } from './RepoRestParamSchema';
import { RepoRestSchema } from './RepoRestSchema';
interface IRepoRESTParam {
    name: string;
    type: string;
    value?: string;
}
export interface IRepoRESTDataModel extends Document {
    endpoint: string;
    method: string;
    type: string;
    dev_key?: string,
    parameters: Array<IRepoRESTParam>
}
export interface IGTFSRepositoryModel extends Document {
    name: string;
    isActive: boolean;
    lastUpdate: Date;
    repositoryUrl: string;
    hash: string;
    repo_data: IRepoRESTDataModel;
}
export class GTFSRepositoryModel implements IPTMHMModel {
    private gtfsRepositorySchema: Schema;
    private repoRestParamSchema: Schema;
    private repoRestSchema: Schema;
    private gtfsRepositoryModel: Model<IGTFSRepositoryModel>;
    constructor() {
        /* schema */
        this.repoRestParamSchema = new RepoRestParamSchema().schema;
        this.repoRestSchema = new RepoRestSchema().schema;
        this.gtfsRepositorySchema = new Schema({
            name: {
                type: String,
                required: true
            },
            isActive: {
                type: Boolean,
                required: true
            },
            lastUpdate: {
                type: Date,
                required: true
            },
            repositoryUrl: {
                type: String,
                required: true
            },
            hash: {
                type: String,
                required: true
            },
            repo_data: this.repoRestSchema

        }, { collection: Config.MONGODB_GTFS_COLL });
        /* model */
        this.gtfsRepositoryModel = mongoose.model<IGTFSRepositoryModel>('GTFSRepository', this.gtfsRepositorySchema);
    }

    model(): Model<IGTFSRepositoryModel> {
        return this.gtfsRepositoryModel;
    }
}