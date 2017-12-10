/*
 * This is an example. Rename it as Config.ts 
 *
*/
import { ITelebotOptions } from './ITeleBotOptions'
export class Config {
    public static readonly BOT_NAME : string = 'PleaseTakeMeHomeBot';
    public static readonly USE_WEBHOOK : boolean = false;
    public static readonly TELEBOT_OPTS : ITelebotOptions = {
        token: 'YOUR_TOKEN',
        webhookOpt: {
            url: '',
            key: '',
            cert:'',
            port: 0,
            host: ''
        },
        pollingOpt: {
            interval: 1000 * 3
        }
    };
}