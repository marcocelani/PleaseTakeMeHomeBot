import * as TeleBot from 'telebot';
import * as moment from 'moment';
import { Config } from './Config';
import { ITelebotOptions } from './ITeleBotOptions';

export class TakeMeHomeBot {
    private telebot : TeleBot;

    constructor(private config? : ITelebotOptions){
        if(!config)
            config = Config.TELEBOT_OPTS;
        this.telebot = new TeleBot(config);
        this.telebot.on('/hello', (msg) => {
            return this.telebot.sendMessage(msg.from.id, `Hello, ${ msg.from.first_name }!`);
          });;
    }
    
    private getTimeStamp() : string {
        return moment().format('DD/MM/YYYY HH:mm');
    }

    private logErr(mex : string) : void {
        console.error(`[${this.getTimeStamp()}] ${mex}`);
    }

    private logInfo(mex : string) : void {
        console.log(`[${this.getTimeStamp()}] ${mex}`);
    }

    init() : void {
        this.logInfo(`Starting ${Config.BOT_NAME}...`);
        this.telebot.start();
    }    
}