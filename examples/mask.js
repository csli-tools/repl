import { toBase64, toUtf8 } from "@cosmjs/encoding";
/*** END auto-gen ****/
const base64Msg = (msg) => toBase64(toUtf8(JSON.stringify(msg)));
const sendMsg = (from_address, to_address, amount) => {
    return {
        send: {
            from_address,
            to_address,
            amount,
        },
    };
};
const contractMsg = (contract_addr, msg, amount) => {
    return {
        contract: {
            contract_addr,
            msg: base64Msg(msg),
            send: amount || null,
        },
    };
};
const opaqueMsg = (data) => {
    return {
        opaque: {
            data: base64Msg(data),
        },
    };
};
