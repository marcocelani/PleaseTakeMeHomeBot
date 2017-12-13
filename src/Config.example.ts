/*
 * This is an example. Rename it as Config.ts 
 *
*/
import * as TeleBot from 'telebot';
export class Config {
    public static readonly BOT_NAME : string = 'PleaseTakeMeHomeBot';
    public static readonly USE_WEBHOOK : boolean = false;
    public static readonly TELEBOT_OPTS : TeleBot.config = {
        token: 'YOUR_TOKEN',
        polling: {
            interval: 1000 * 3
        }
    };
}