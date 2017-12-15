import { ObjectId } from "bson";

export class GTFSRepository {
    public _id : ObjectId;
    public city : string;
    public repositoryUrl : string;
    public lastUpdate : Date;
    public dataHash : string;
}