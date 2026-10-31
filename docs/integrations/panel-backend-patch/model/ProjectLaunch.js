import mongoose from "mongoose";
import { mongooseModel } from "../utils/index.js";
const filterSchema=new mongoose.Schema({
    type:{
        type:String,
        required:true
    },
    value:{
        type: mongoose.Schema.Types.Mixed
    }
},{_id:false})
// A quota within a market: its own filters on top of the market's, and a target count of completes.
const quotaSchema=new mongoose.Schema({
    quotaID:{
        type:String,
        required:true,
        trim:true
    },
    label:{
        type:String,
        trim:true
    },
    filters:[filterSchema],
    target:{
        type:Number,
        min:[0,"Quota target cannot be negative"]
    }
},{_id:false})
export default mongooseModel(
    "SurveyProject",
    {
        pid: {
            type: String,
            required: true
        },
        name: {
            type: String
        },
        note: {
            type: String
        },
        source: {
            type: String
        },
        status: {
            type: String,
            default: "Drafted"
        },
        markets: [{
            marketID: {
                type: String,
                required: true
            },
            country: [{
                type: String
            }],
            targetGroup:{
                type:String
            },
            filters: [filterSchema],
            quotas: [quotaSchema],
            softLaunch: {
                enabled: {
                    type: Boolean,
                    default: false
                },
                completes: Number
            },
            cpi:{
                type:Number
            },
            loi:{
                type:Number
            },
            ir:{
                type:Number
            },
            completes:{
                type:Number
            },
            schedule:{
                time:{
                    type:Date,
                },
                frequency:{
                    type:String
                },
                batch:{
                    type:Number
                }
            },
            links:{
                test:{
                    type:String,
                },
                live:{
                    type:String
                }
            }
        }]
    }
)