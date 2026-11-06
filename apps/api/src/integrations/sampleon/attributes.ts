/**
 * The profile attribute catalogue SUPPLY360 offers SAMPLEON (GET /s2s/supply/attributes).
 * Base attributes come from Panelist columns; the rest are PanelistAttribute rows.
 * SAMPLEON can only target what is listed here.
 */
import type { AttributeDef } from '@sampledge/contracts';

export const PANEL_OF_BRAND: Record<string, 't2o' | 'mfr' | 'mho'> = { turn2opinion: 't2o', myfrequentrewards: 'mfr', myhealthopinions: 'mho' };
export const BRAND_OF_PANEL: Record<string, string> = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' };

/** Keys read from Panelist columns rather than PanelistAttribute rows. */
export const BASE_KEYS = ['demo.gender', 'demo.age_band', 'panelist.segment', 'panelist.quality_score'] as const;

export const SUPPLY_ATTRIBUTES: AttributeDef[] = [
  { key: 'demo.gender', label: 'Gender', type: 'enum', values: ['female', 'male', 'nonbinary', 'undisclosed'], sensitivity: 'standard', synonyms: { female: ['women', 'woman', 'mothers', 'moms'], male: ['men', 'man', 'fathers', 'dads'] } },
  { key: 'demo.age_band', label: 'Age band', type: 'enum', values: ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'], sensitivity: 'standard' },
  { key: 'demo.age', label: 'Age', type: 'number', sensitivity: 'standard' },
  { key: 'panelist.segment', label: 'Panel segment', type: 'enum', values: ['consumer', 'professional', 'hcp', 'patient', 'caregiver'], sensitivity: 'standard', synonyms: { consumer: ['consumers', 'general population', 'gen pop'], professional: ['b2b', 'business professionals'], hcp: ['healthcare professionals', 'hcps', 'doctors', 'physicians'], caregiver: ['caregivers', 'carers'] } },
  { key: 'panelist.quality_score', label: 'Account quality score (0–1)', type: 'number', sensitivity: 'standard' },
  { key: 'hcp.specialty', label: 'Medical specialty', type: 'enum', values: ['cardiology', 'oncology', 'general_practice', 'dermatology', 'neurology', 'endocrinology', 'pediatrics', 'psychiatry'], sensitivity: 'standard',
    synonyms: { cardiology: ['cardiologist', 'heart specialist'], oncology: ['oncologist', 'cancer specialist'], general_practice: ['gp', 'general practitioner', 'family doctor'], dermatology: ['dermatologist'], neurology: ['neurologist'], endocrinology: ['endocrinologist'], pediatrics: ['pediatrician', 'paediatrician'], psychiatry: ['psychiatrist'] } },
  { key: 'hcp.role', label: 'Healthcare role', type: 'enum', values: ['physician', 'nurse', 'pharmacist', 'other'], sensitivity: 'standard', synonyms: { nurse: ['nurses'], pharmacist: ['pharmacists'] } },
  { key: 'b2b.years_experience', label: 'Years of professional experience', type: 'number', sensitivity: 'standard', synonyms: { _phrases: ['years of experience', 'experience', 'years in practice'] } },
  { key: 'b2b.role', label: 'Job role', type: 'enum', values: ['it_decision_maker', 'hr', 'finance', 'marketing', 'operations', 'c_suite'], sensitivity: 'standard', synonyms: { it_decision_maker: ['it decision maker', 'itdm', 'it decision-maker'], c_suite: ['c-suite', 'executive', 'ceo', 'cfo', 'cto'], hr: ['hr manager', 'human resources'] } },
  { key: 'b2b.company_size', label: 'Company size (employees)', type: 'number', sensitivity: 'standard', synonyms: { _phrases: ['employees', 'staff'] } },
  { key: 'b2b.industry', label: 'Industry', type: 'enum', values: ['technology', 'healthcare', 'finance', 'retail', 'manufacturing', 'education', 'public_sector'], sensitivity: 'standard' },
  { key: 'health.diabetes', label: 'Diagnosed with diabetes', type: 'boolean', sensitivity: 'health', synonyms: { true: ['diabetics', 'with diabetes', 'diabetes patients'] } },
  { key: 'health.hypertension', label: 'Diagnosed with hypertension', type: 'boolean', sensitivity: 'health', synonyms: { true: ['hypertension', 'high blood pressure'] } },
  { key: 'health.asthma', label: 'Diagnosed with asthma', type: 'boolean', sensitivity: 'health', synonyms: { true: ['asthmatics', 'with asthma'] } },
];

export const ATTRIBUTE_BY_KEY = new Map(SUPPLY_ATTRIBUTES.map((a) => [a.key, a]));
export const isHealthKey = (k: string) => ATTRIBUTE_BY_KEY.get(k)?.sensitivity === 'health';
