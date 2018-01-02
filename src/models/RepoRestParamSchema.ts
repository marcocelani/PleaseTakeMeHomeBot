import { Schema } from "mongoose";

export class RepoRestParamSchema {
    private repoRestParamSchema: Schema;
    constructor(){
        this.repoRestParamSchema = new Schema({
            name: {
                type: String,
                required: true
            },
            type: {
                type: String,
                required: true
            },
            value: String
        });
    }
    get schema(): Schema {
        return this.repoRestParamSchema;
    }
}