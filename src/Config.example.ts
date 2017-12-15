/*
 * This is an example. Rename it as Config.ts 
 *
*/
/*
 * This is an example. Rename it as Config.ts 
 *
*/
import * as TeleBot from 'telebot';
export class Config {
    public static readonly BOT_NAME : string = 'YOUR_BOT_NAME';
    public static readonly MONGODB_URI : string  = 'mongodb://localhost/YOUR_DB';
    public static readonly MONGODB_CONFIG_COLL : string = 'YOUR_CONFIG_COLL';
    public static readonly MONGODB_GTFS_COLL : string = 'YOUR_GTFS_REPOSITORIES';
    public static readonly UPDATE_DAY_AFTER : number = 2;
    public static readonly TMP_DIR_NAME : string = 'YOUR_TMP_DIR';
    public static readonly DefaultConfig : TeleBot.config = {
        token: 'YOUR_TOKEN',
        polling: {
            interval: 1000 * 3
        }
    }
}