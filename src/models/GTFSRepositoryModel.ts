import * as mongoose from 'mongoose';
import { Schema, Document, Model, Connection } from 'mongoose';
import { IPTMHMModel } from './IPTMHModel';
import { Config } from '../Config';

export interface IGTFSRepositoryModel extends Document {
    name: string;
    isActive: boolean;
    lastUpdate: Date;
    repositoryUrl: string;
    hash: string;
}
export class GTFSRepositoryModel implements IPTMHMModel {
    private gtfsRepositorySchema: Schema;
    private gtfsRepositoryModel: Model<IGTFSRepositoryModel>;
    constructor() {
        /* schema */
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
            }
        }, { collection: Config.MONGODB_GTFS_COLL});
        /* model */
        this.gtfsRepositoryModel = mongoose.model<IGTFSRepositoryModel>('GTFSRepository', this.gtfsRepositorySchema);
    }

    model(): Model<IGTFSRepositoryModel> {
        return this.gtfsRepositoryModel;
    }
}