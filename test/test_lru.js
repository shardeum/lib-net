"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var commander_1 = require("commander");
var _1 = require("../.");
var setupLruSender = function (port, lruSize) {
    return (0, _1.Sn)({
        port: port,
        address: '127.0.0.1',
        crypto: {
            signingSecretKeyHex: 'c3774b92cc8850fb4026b073081290b82cab3c0f66cac250b4d710ee9aaf83ed8088b37f6f458104515ae18c2a05bde890199322f62ab5114d20c77bde5e6c9d',
            hashKey: '69fa4195670576c0160d660c3be36556ff8d504725be8a59b5a96509e0c994bc',
        },
        senderOpts: {
            useLruCache: true,
            lruSize: lruSize,
        },
        headerOpts: {
            sendHeaderVersion: 1,
        },
    });
};
var main = function () { return __awaiter(void 0, void 0, void 0, function () {
    var program, port, cacheSize, sn, input;
    return __generator(this, function (_a) {
        /*
          create a cli with the following options:
            -p, --port < port > Port to listen on
            -c, --cache < size > Size of the LRU cache
          
          the cli should create a sender with the following options:
            - lruSize: <size>
            - port: <port>
      
          on running the cli a listener should be started and sending of message with input from terminal should be allowed
        */
        console.log('Starting cli...');
        program = new commander_1.Command();
        program.requiredOption('-p, --port <port>', 'Port to listen on');
        program.option('-c, --cache <size>', 'Size of the LRU cache', '2');
        program.parse(process.argv);
        port = program.port.toString();
        cacheSize = program.cache.toString();
        console.log("Starting listener on port ".concat(port, " with cache size ").concat(cacheSize));
        sn = setupLruSender(+port, +cacheSize);
        input = process.stdin;
        input.addListener('data', function (data) { return __awaiter(void 0, void 0, void 0, function () {
            var inputs, message, i;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        inputs = data.toString().trim().split(' ');
                        if (!(inputs.length === 3)) return [3 /*break*/, 8];
                        message = receipt;
                        _a.label = 1;
                    case 1:
                        if (!true) return [3 /*break*/, 7];
                        i = 0;
                        _a.label = 2;
                    case 2:
                        if (!(i < 10000)) return [3 /*break*/, 5];
                        return [4 /*yield*/, sn.sendWithHeader(+inputs[1], '127.0.0.1', { message: message, fromPort: +port }, {
                                sender_id: 'test',
                                tracker_id: 'test',
                                verification_data: 'test',
                            }, 1000, function (data, header) {
                                // console.log('onResp: Received response:', JSON.stringify(data, null, 2))
                                if (header) {
                                    // console.log('onResp: Received header:', JSON.stringify(header, null, 2))
                                }
                            })];
                    case 3:
                        _a.sent();
                        _a.label = 4;
                    case 4:
                        i++;
                        return [3 /*break*/, 2];
                    case 5: return [4 /*yield*/, sleep(50)];
                    case 6:
                        _a.sent();
                        console.log("Sent 10000 messages to port");
                        return [3 /*break*/, 1];
                    case 7: return [3 /*break*/, 9];
                    case 8:
                        if (inputs.length === 2) {
                            sn.evictSocket(+inputs[1], '127.0.0.1');
                            console.log('Cache cleared');
                        }
                        else {
                            console.log('=> send <port> <message>');
                            console.log('=> clear <port>');
                        }
                        _a.label = 9;
                    case 9: return [2 /*return*/];
                }
            });
        }); });
        sn.listen(function (data, remote, respond, header, sign) { return __awaiter(void 0, void 0, void 0, function () {
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!(data && data.message !== null)) return [3 /*break*/, 2];
                        // console.log('Received ping from:', data.fromPort)
                        // console.log('Ping header:', JSON.stringify(header, null, 2))
                        return [4 /*yield*/, getRandomNumber(1, 500)];
                    case 1:
                        // console.log('Received ping from:', data.fromPort)
                        // console.log('Ping header:', JSON.stringify(header, null, 2))
                        _a.sent();
                        return [2 /*return*/, respond({ message: 'pong', fromPort: +port }, {
                                sender_id: 'test',
                                tracker_id: 'test',
                                verification_data: 'test',
                            })];
                    case 2:
                        if (data && data.message === 'pong') {
                            console.log('Received pong from:', data.fromPort);
                        }
                        if (header) {
                            console.log('Received header:', JSON.stringify(header, null, 2));
                        }
                        if (sign) {
                            console.log('Received signature:', JSON.stringify(sign, null, 2));
                        }
                        return [2 /*return*/];
                }
            });
        }); });
        return [2 /*return*/];
    });
}); };
function getRandomNumber(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
var sleep = function (ms) {
    return new Promise(function (resolve) { return setTimeout(resolve, ms); });
};
main().catch(function (err) { return console.log('ERROR: ', err); });
var receipt = {
    url: 'gossip',
    body: {
        payload: {
            data: {
                appliedVotes: [
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: 'b029862210a418c7dcd9470badecd0180d7d8730fa4372fd7596e370b49d5365',
                        sign: {
                            owner: 'ee3227df3dd02934fba5b220df750e492ae2e7801b5fdc8db478e7ca7ca48628',
                            sig: '44c3910e576ebea04c4e0d0055766253224cbf8c783c01378ad6b3e9f95c02af8357fd8ea690751cbc73f1e322073999cd0fba667b40ae9b1831481efd4f2b02f6d2ccc6459169a0a53839b01f382e850987eecdab5b649d09a99843c5557ab0',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: 'ac2b820c15f4c16b33b914411be08ea36eaaebcdb0d788c36359a33cbc30e54f',
                        sign: {
                            owner: '84558477feac808ba30eac2edad817660c1be7d7cc33475d1997ba0c748bc071',
                            sig: 'b0d4a9375a3b8729d0f5d7acd4a2b68f3a621e3bf87dcdb75fac70a9299ca2195c12dd68b6f60cd874b02f691889efe26a976df3445ba58c86e18df67120fb03aafc41adb06a1501081398b7cbead741a50936a53c2c052252326a60da703f8a',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: 'd1503ab0d73baae0c78f59e593a245b53629271eabbd1871c1b76689d7b40399',
                        sign: {
                            owner: '756167f13eda81a0db53ad28c2739435669bab8de1a110f2da544a93c16d4829',
                            sig: 'f6e61970af89c3058d96753987aa32b1a09123c93da2e7ee4651abaf71f1727a51b4fa13ec8d3c44f69089dc7e9bda8f3c9745ef90232dc7ff33a42f3c93d706745cbe809984d5addb2a8f4a7a41f6c956f8aa750689d843936564eed00d75fc',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: 'c93aae0030b0e14e507f13d31225799188eaa8a7571347e14f0b266a6b745b2a',
                        sign: {
                            owner: '2e538ba44296f0b34791a18ed2dbf49fb80234bf0b81be07587a3e8e5a2e2de2',
                            sig: '50f787210cfddd6e264adb837f3753791556016721d52eb41c2e1fe4678bcb0eddc2632573387145ede01d1535734acd211a36c02e6f697e94fe478025866f00573dd66d46f1b612c1711142c83ee0fd7e12f0cd0b2887d2ff66ed89a3eb74a1',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: '8a892abb53d4d93405eda129a3d157f38eb746f3642845bc9a5c7b771b66e211',
                        sign: {
                            owner: '453e9885dfb519a092b23f212f5ccea9be0903e9cfbd3ba2466c64b85f8ee1ad',
                            sig: 'b7127fec57eefcc7043947612f65bbd9cf1d58e790a4a0406d1fdd37a8a081ff3f44d8f626628b057881abbf262c6e9122eb4cb017fdf2f28775cef6c49da8085fcaf76e601fb273e451937f9383511de71e9aa7409cee38ae985ea4e944e49c',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: '97463e902b95b4f6049ec4ee4d72744d7c79fd89fa1a35da51c0a1fcf707e1d2',
                        sign: {
                            owner: '12545e4c84253feb6cd3eb74d061ac73c1a954c5fd2664c356e56a62807e89cd',
                            sig: '6476cb4d7b6ac0f0f7f81506e8f7136a6a7ab33abc25f54bf5e6ceed1eb0a41b59a5170433bb58ec491c55f27a5da66def808f4d31c085d8c475baa2007efd0d885df62afbd132431b59f626fd7ea1c1b6f1b39674c543e39e21b9959a279b3b',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: 'f6ddc3b3e257a36f1d110238cee6efee8869377d32495cddbc76a1ea8f64f8ce',
                        sign: {
                            owner: 'e8c6585706b6f0dd3a9a586d252737d8cba8f6aa3d709f5e028bf91bdf645cdf',
                            sig: '1a6b3cf2c568a28d8cfb0e954e98cc66b317951dc186b6cc21b6e0ba052486011c02319877111e96d3bdcda50f661dbb6defeda41e7501e728b5a0768a2b8d0dc5ed5b42df87854c784f6ea2097baf5ac5d5e77c9631a5a6031da2230ba440ac',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                            '0000000000000000000000000000000000000000000000000000000000000000',
                        ],
                        account_state_hash_after: [
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                        ],
                        cant_apply: false,
                        node_id: 'f0e510985dcdb846c27f7718a7338729adbc7d58ba3303ac1431e513db707602',
                        sign: {
                            owner: '05befa952d1f8ff18b175a8d6e17260e72f02c79ee2f959ab088a605e262940f',
                            sig: 'b63f88b0a650e718616d50cbc37b77cdc42efe2bdb0b2369569978919d76bac13ac76ad21ca883052a2d9bc3bda6c32d271fcba418d88e033e0033c7fffb0d0f3ae3d7fbe1757c588768206fe14866d7f702fc785ee3ab7e86af00d69d698a5c',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: '7f9ff8e45f8ecb781e427e26afd9c2e8d60c3abeaf39aeadf6bc52c48a5bb6f0',
                        sign: {
                            owner: '79f4d805734d5e94e501c1bba1568594466dc6e1def528fea41936f5e1172582',
                            sig: '621fa51633dad15bde5f7e7f1b5c86374e22cbb08cdd75814523a1ca21d0a5a5283e905262eae4ac3056115b68448b2cb872c562f8fdafb378eb1fa51309ea0135ae0e738c62af5dfbf906e1fac43404d4fa92c2fec7db3c0387178b20735ba5',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                    {
                        account_id: [
                            '0000000000000000000000000000000000000000000000000000000000000000',
                            'bceb452e8d571287d98bd865456d7b6693e2fdf5a41221250b509a551fc9d6b6',
                        ],
                        account_state_hash_after: [
                            '9f5e3ef54fe9ea648d1b8ef4f00b11fd51373ae7d8b54fb6d60b11fc54787db4',
                            '61c505cf64771fc150dd519f21c1df0db1e6fcbf3be66476646ad70da844fa9f',
                        ],
                        cant_apply: false,
                        node_id: '6b952862deaeb4e081926d1bf312faea900d066a69df6b16d161cc2ef4798d56',
                        sign: {
                            owner: '7603ed5d4be196af734e9afaae5ec058eb1c28449b5b2c6183fb0735b7ed9c17',
                            sig: '29f0258a26e27f86c3b13c4931bb52dd69110f6635881db0025b3e1c569db7db35693494f00bcd98fd60621d1def073cee0b0779a53ea118d5cfa93ebbb668089e437ba23e75b7a1a0ee80acf6c6a9221200f53fc744a4fce661b2afe0e6ecbd',
                        },
                        transaction_result: true,
                        txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
                    },
                ],
                result: true,
                txid: '331f97e5ca8f72d7fb0726c9c56e60092297397b6cf4ea7e4b9cee5093fc1457',
            },
            type: 'spread_appliedReceipt',
        },
        sender: 'f6ddc3b3e257a36f1d110238cee6efee8869377d32495cddbc76a1ea8f64f8ce',
        tracker: 'gkey_b029xd5365_1628829481425_221494',
        tag: 'ad8f673456f07d4ce4c57e06c14c380a8a87800f65dadd96fd956c01a6503587e7ab80943e0341e3edecd92074729479d1eca8c232819b4149ba2f34629db549',
    },
};
