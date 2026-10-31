import type { SurveyDef } from './engine';

/**
 * DEMO questionnaire: "Brand Health Tracker Q4" (fictional, Published). It gives the demo one live
 * survey whose public respondent link works without signing in. Brand names are placeholders.
 */
export const brandSurvey: SurveyDef = {
  id: 'sv-002',
  name: 'Brand Health Tracker Q4',
  version: 1,
  questions: [
    { id: 'S1', block: 'Screener', type: 'single', text: 'Which age group are you in?', options: [
      { code: 'u18', label: 'Under 18' }, { code: 'a1', label: '18–34' }, { code: 'a2', label: '35–54' }, { code: 'a3', label: '55+' }] },
    { id: 'Q1', block: 'Awareness', type: 'multi', randomize: true, text: 'Which of these coffee brands have you heard of?', options: [
      { code: 'b1', label: 'Brand A' }, { code: 'b2', label: 'Brand B' }, { code: 'b3', label: 'Brand C' }, { code: 'b4', label: 'Brand D' }, { code: 'none', label: 'None of these', exclusive: true }] },
    { id: 'Q2', block: 'Usage', type: 'single', text: 'Which brand do you buy most often?', displayIf: { q: 'Q1', op: 'nin', values: ['none'] }, options: [
      { code: 'b1', label: 'Brand A' }, { code: 'b2', label: 'Brand B' }, { code: 'b3', label: 'Brand C' }, { code: 'b4', label: 'Brand D' }, { code: 'oth', label: 'Another brand' }] },
    { id: 'Q3', block: 'Perception', type: 'matrix', text: 'How well does each statement describe Brand A?', rows: [
      { code: 'quality', label: 'High quality' }, { code: 'value', label: 'Good value' }, { code: 'modern', label: 'Modern' }],
      options: [{ code: '1', label: 'Not at all' }, { code: '2', label: 'Slightly' }, { code: '3', label: 'Mostly' }, { code: '4', label: 'Completely' }] },
    { id: 'Q4', block: 'Advocacy', type: 'nps', min: 0, max: 10, text: 'How likely are you to recommend Brand A to a friend?' },
    { id: 'Q5', block: 'Advocacy', type: 'text', required: false, text: 'What is the main reason for your score of {{Q4}}?' },
    { id: 'END', block: 'Close', type: 'info', text: 'Thank you. Your responses have been recorded (demo).' },
  ],
  rules: [
    { id: 'r1', after: 'S1', when: { q: 'S1', op: 'eq', value: 'u18' }, action: { terminate: 'screenout' } },
    { id: 'r2', after: 'Q1', when: { q: 'Q1', op: 'eq', value: 'none' }, action: { terminate: 'screenout' } },
  ],
  quotas: [],
};
