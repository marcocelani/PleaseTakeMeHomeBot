import * as emoji from 'node-emoji';

interface WaitingData {
    linea: string;
    capolinea: string;
    annuncio: string;
}
interface WaitingDictionary {
    [key: string]: Array<WaitingData>;
}
export class ResponseMessage {
    private stop_id: string;
    private stop_name: string;
    private stop_desc: string;
    private waiting_time: WaitingDictionary;
    constructor(stop_id: string, stop_name: string, stop_desc: string) {
        this.stop_id = stop_id;
        this.stop_name = stop_name;
        this.stop_desc = stop_desc;
        this.waiting_time = {};
    }
    addWaitingData(linea: string, capolinea: string, annuncio: string): void {
        const arr_item: WaitingData = {
            linea: linea,
            capolinea: capolinea,
            annuncio: annuncio
        }
        if (!this.waiting_time[linea + ' ' + capolinea])
            this.waiting_time[linea + ' ' + capolinea] = [];
        this.waiting_time[linea + ' ' + capolinea].push(arr_item);
    }
    get message(): string {
        let mex: string = `${emoji.get('id') +
            this.stop_id}\n${emoji.get('busstop') +
            this.stop_name}\n${emoji.get('mag') +
            this.stop_desc}\n\n`;

        for (let dic_key in this.waiting_time) {
            mex += emoji.get('oncoming_bus') + ' ' + dic_key + '\n';
            if (this.waiting_time[dic_key].length == 0) {
                mex += emoji.get('skull') + ' ' + 'No information.' + '\n';
            } else {
                for (let arr_item of this.waiting_time[dic_key]) {
                    mex += emoji.get('watch') + ' ' + arr_item.annuncio + '\n';
                }
            }
            mex += '\n';
        }
        return mex;
    }
} 