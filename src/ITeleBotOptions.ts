export interface ITelebotOptions {
    token : string;
    pollingOpt? : ITBPolling;
    webhookOpt? : ITBWebHook;
}

interface ITBPolling {
    interval? : number;
}

interface ITBWebHook {
    url : string;
    key : string;
    cert: string;
    port: number;
    host: string;
}