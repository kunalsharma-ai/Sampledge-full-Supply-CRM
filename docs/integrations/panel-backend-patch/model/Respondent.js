import mongoose from "mongoose";
import { mongooseModel } from "../utils/index.js";
import dns from "dns";
import bcrypt from "bcryptjs";
import { promisify } from "util"
import { parsePhoneNumberFromString } from "libphonenumber-js"
import { integrationFields, addressFields, ageParts, ageBand, hasConsent, dedupeKeyFor, assertAdmin, syncConsentState } from "../integration/fields.js";
import { toCountryCode } from "../integration/country.js";

const resolveMx = promisify(dns.resolveMx)

const Respondent = mongooseModel(
    "Respondent",
    {
        respondentID: {
            type: String
        },
        category: {
            type: String,
            required: [true, "Please select if you are medical professional, caregiver or a patient."],
            enum: ["Professional", "Care Giver", "Patient"]
        },
        name: {
            salutation: {
                type: String,
                trim: true,
                enum: ["Mr.", "Ms.", "Mrs.", "Dr.", "Prof.", "Mx."]
            },
            first: {
                type: String,
                trim: true,
                required: [true, "Firstname is required"]
            },
            middle: {
                type: String,
                trim: true,
                default: ""
            },
            last: {
                type: String,
                trim: true,
                required: [true, "Lastname is required"]
            }
        },
        gender: {
            type: String,
            enum: ["Male", "Female", "Other"],
            required: [true, "Gender is required"]
        },
        dob: {
            type: Date,
            required: [true, "Date of birth is required"],
            validate: {
                validator: function (value) {
                    if (!value || isNaN(new Date(value).getTime())) return false;
                    const today = new Date();
                    const age = (today - new Date(value)) / (1000 * 60 * 60 * 24 * 365.25);
                    return age >= 13 && age <= 120;
                },
                message: "Date of birth must result in age between 13 and 120 years"
            }
        },
        email: {
            type: String,
            required: [true, "Email is required"],
            unique: [true, "You are already registered."],
            lowercase: true,
            trim: true,
            match: [
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                "Please enter a valid email address",
            ],
            validate: {
                validator: async function (email) {
                    // Extract domain
                    const domain = email.split("@")[1];
                    if (!domain) return false;
                    try {
                        const records = await resolveMx(domain);
                        return records && records.length > 0; // has MX record
                    } catch (err) {
                        return false; // domain has no MX record or not resolvable
                    }
                },
                message: "Please type correct email address.",
            },
        },
        phone: {
            type: String,
            unique: [true, "Phone number is already in use by another user"],
            trim: true,
            validate: {
                validator: function (v) {
                    if (!v) return false;
                    const phoneNumber = parsePhoneNumberFromString(`+${v}`);
                    return phoneNumber ? phoneNumber.isValid() : false;
                },
                message: props => `${props.value} is not a valid phone number`
            },
            set: function (v) {
                const phoneNumber = parsePhoneNumberFromString(v);
                return phoneNumber ? phoneNumber.format("E.164") : v;
            }
        },
        timezone: {
            type: String,
            required: [true, "Timezone required"]
        },
        address: [{
            tag: {
                type: String,
                trim: true,
                required: [true, "Define tag for address"]
            },
            house: {
                type: String,
                trim: true,
                lowercase: true,
            },
            street: {
                type: String,
                trim: true,
                lowercase: true,
            },
            city: {
                type: String,
                trim: true,
                lowercase: true,
            },
            state: {
                type: String,
                trim: true,
                lowercase: true,
            },
            country: {
                type: String,
                trim: true,
                lowercase: true,
            },
            zipcode: {
                type: String,
                trim: true,
                lowercase: true,
            },
            ...addressFields,
            gps: {
                type: {
                    type: String,
                    enum: ["Point"],
                    default: "Point"
                },
                coordinates: {
                    type: [Number],
                    default: [0, 0]
                }
            }
        }],
        isVerified: {
            email: {
                type: String,
                enum: ["unverified", "verified", "rejected"],
                default: "unverified"
            },
            phone: {
                type: String,
                enum: ["unverified", "verified", "rejected"],
                default: "unverified"
            },
            video: {
                type: String,
                enum: ["unverified", "verified", "rejected"],
                default: "unverified"
            },
            inPersonVisit: {
                type: String,
                enum: ["unverified", "verified", "rejected"],
                default: "unverified"
            },
        },
        profilePicture: {
            type: String,
            default: null
        },
        notification: [
            {
                channel: { type: String, required: true },
                category: [{
                    type: String
                }],
                identity: {
                    type: String,
                    required: true
                }
            }
        ],
        // Was misspelled "concent"; run migrations/2026-10-31-sampledge-fields.js to rename stored data.
        // Device permissions only. Consent to invitations, profiling, sharing and health data is in `consents`.
        consent: {
            canShareVideo: { type: Boolean, default: false },
            canShareGPS: { type: Boolean, default: false },
            canAcceptPushNotification: { type: Boolean, default: false },
        },
        ...integrationFields,
        // How a healthcare professional was verified. The licence number itself stays out of this record.
        hcpVerification: {
            method: { type: String, enum: ["licence_lookup", "document_review", "employer_email", "phone_call", null], default: null },
            status: { type: String, enum: ["unverified", "pending", "verified", "rejected"], default: "unverified" },
            verifiedAt: { type: Date, default: null },
        },
        passwordHash: { type: String, select: false },
    },
    [
        [
            {
                email: 1,
                origin: 1
            },
            {
                unique: true
            }
        ]
    ],
    {
        virtuals: {
            fullName: function () {
                return [this.name.salutation, this.name.first, this.name.middle, this.name.last]
                    .filter(Boolean)
                    .join(" ");
            },
            age: function () {
                return ageParts(this.dob);
            },
            ageBand: function () {
                return ageBand(this.dob);
            },
            isMinor: function () {
                const a = ageParts(this.dob);
                return a ? a.years < 18 : null;
            }
        },
        pre: {
            save: function (next) {
                // Keep the ISO country code in step with the free-text country; unknown spellings stay null for review.
                for (const a of this.address ?? []) {
                    if (a.country && (!a.countryCode || this.isModified("address"))) a.countryCode = toCountryCode(a.country) ?? a.countryCode ?? null;
                }
                if (this.isModified("email")) {
                    const key = dedupeKeyFor(this.email);
                    if (key) this.dedupeKey = key;
                }
                if (this.isNew || this.isModified("consents")) syncConsentState(this);
                next();
            }
        },
        method: {
            hasConsent: function (purpose) {
                return hasConsent(this, purpose);
            },
            resetPassword: async function (admin, password) {
                assertAdmin(admin);
                this.isVerified.email="verified";
                this.passwordHash=await bcrypt.hash(password,10);
                await this.save();
                return this;
            },
            changePassword: async function (currentPassword, newPassword) {
                // passwordHash is select:false, so it is not on `this` after a normal find: read it explicitly.
                const stored = await this.constructor.findById(this._id).select("+passwordHash");
                if(!stored?.passwordHash || !(await bcrypt.compare(currentPassword,stored.passwordHash)))throw new Error("Current password invalid. Check your password and try again.");
                this.isVerified.email="verified";
                this.passwordHash=await bcrypt.hash(newPassword,10);
                await this.save();
                return this;
             },
        }
    }
)
export default Respondent;