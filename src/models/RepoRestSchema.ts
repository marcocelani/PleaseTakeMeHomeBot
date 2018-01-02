import { Schema } from "mongoose";
import { RepoRestParamSchema } from "./RepoRestParamSchema";

export class RepoRestSchema {
    private repoRestSchema: Schema;
    private repoRestParamSchema: Schema;
    constructor(){
        this.repoRestParamSchema = new RepoRestParamSchema().schema;
        this.repoRestSchema = new Schema({
            endpoint: {
                type: String,
                required: true
            },
            method: {
                type: String,
                required: true
            },
            type: {
                type: String,
                required: true
            },
            dev_key: String,
            parameters: {
                type: [this.repoRestParamSchema],
                required: true
            }
        });
    }
    get schema(): Schema {
        return this.repoRestSchema;
    }
}