import * as moongose from 'mongoose';
import { Schema, Model, Document, Connection } from 'mongoose';
import { Config } from '../Config';
import { IPTMHMModel } from './IPTMHModel';

export interface IConfigModel extends Document {
    token : string
}
export class ConfigModel implements IPTMHMModel {
    private configSchema : Schema;
    private configModel : Model<IConfigModel>;
    constructor() {
        /* schema */
        this.configSchema = new Schema({
            token : { 
                type: String,
                required: true
            },
            polling : {
                interval : Number
            }  
        }, { collection : Config.MONGODB_CONFIG_COLL, timestamps: {} });
        /* model */
        this.configModel = moongose.model<IConfigModel>('Config', this.configSchema);
    }
    model() : Model<IConfigModel> {
        return this.configModel;
    }
}