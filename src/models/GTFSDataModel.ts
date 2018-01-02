import * as moongose from 'mongoose';
import { Schema, Model, Document, Connection } from 'mongoose';
import { IPTMHMModel } from './IPTMHModel';
import { ObjectID } from 'bson';
import { Config } from '../Config';
import { IRepoRESTDataModel } from './GTFSRepositoryModel';
import { RepoRestParamSchema } from './RepoRestParamSchema';
import { RepoRestSchema } from './RepoRestSchema';

interface ILocation {
    type: string;
    coordinates: Array<Number>;
}
export interface IGTFSDataModel extends Document {
    referenceId: string;
    stop_id: string;
    stop_code?: string;
    stop_name: string;
    stop_desc?: string;
    location : ILocation;
    zone?: number,
    stop_url?: string,
    location_type?: string,
    parent_station?: number;
    repo_data: IRepoRESTDataModel;
}
export class GTFSDataModel implements IPTMHMModel{
    private gtfsDataSchema : Schema;
    private repoRestParamSchema: Schema;
    private repoRestSchema: Schema;
    private gtfsDataModel : Model<IGTFSDataModel>;
    constructor() {
        /* schema */
        this.repoRestParamSchema = new RepoRestParamSchema().schema;
        this.repoRestSchema = new RepoRestSchema().schema;
        this.gtfsDataSchema = new Schema({
            referenceId : {
                type: String,
                required: true
            },
            stop_id : {
                type: String,
                required: true
            },
            stop_code: String,
            stop_name: {
                type: String,
                required: true
            },
            stop_desc: String,
            location : {
                type: { type: String },
                coordinates: [Number],
            },
            zone: Number,
            stop_url: String,
            location_type: String,
            parent_station: Number,
            repo_data: {
                type: this.repoRestSchema,
                required: true
            }
        }, { collection: Config.MONGODB_GTFS_DATA_COLL});
        this.gtfsDataSchema.index({location: '2dsphere'});
        this.gtfsDataSchema.pre('remove', function(next){
            next();
        });
        this.gtfsDataSchema.pre('save', function(next){
            next();
        });
        /* model */
        this.gtfsDataModel = moongose.model<IGTFSDataModel>('GTFSData', this.gtfsDataSchema);
    }
    model() {
        return this.gtfsDataModel;
    }
}