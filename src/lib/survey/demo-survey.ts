import type { SurveyDef } from './engine';

/**
 * DEMO questionnaire: "Cloud Security Buyer Study" (fictional, for project SE-26101).
 * Two defects are intentionally seeded so the QA engine has something real to find:
 *  - Q12 is unreachable (its display logic requires an option the screener terminates on)
 *  - rule r6 references option "ceo" which does not exist on S3
 */
export const cloudSurvey: SurveyDef = {
  id: 'sv-cloud',
  name: 'Cloud Security Buyer Study',
  version: 4,
  questions: [
    { id: 'S1', block: 'Screener', type: 'single', text: 'Which best describes your current employment status?', options: [
      { code: 'ft', label: 'Employed full-time' }, { code: 'pt', label: 'Employed part-time' }, { code: 'self', label: 'Self-employed' }, { code: 'none', label: 'Not employed' }] },
    { id: 'S2', block: 'Screener', type: 'single', text: 'How many employees work at your organization worldwide?', options: [
      { code: 'xs', label: '1–99' }, { code: 'md', label: '100–999' }, { code: 'lg', label: '1,000 or more' }] },
    { id: 'S3', block: 'Screener', type: 'single', text: 'What is your role in decisions about cloud security products?', options: [
      { code: 'final', label: 'Final decision-maker' }, { code: 'influence', label: 'Significant influence' }, { code: 'minor', label: 'Minor input' }, { code: 'no', label: 'No involvement' }] },
    { id: 'S4', block: 'Screener', type: 'multi', randomize: true, text: 'Which industries does your organization operate in?', options: [
      { code: 'fin', label: 'Financial services' }, { code: 'hc', label: 'Healthcare' }, { code: 'tech', label: 'Technology' }, { code: 'mfg', label: 'Manufacturing' }, { code: 'ret', label: 'Retail' }, { code: 'oth', label: 'Other' }, { code: 'mr', label: 'Market research or advertising', exclusive: true }] },
    { id: 'Q1', block: 'Current stack', type: 'multi', randomize: true, text: 'Which cloud platforms does your organization use today?', options: [
      { code: 'aws', label: 'Platform A' }, { code: 'az', label: 'Platform B' }, { code: 'gcp', label: 'Platform C' }, { code: 'oci', label: 'Platform D' }, { code: 'priv', label: 'Private cloud' }, { code: 'none', label: 'None of these', exclusive: true }] },
    { id: 'Q2', block: 'Current stack', type: 'single', text: 'Which of {{Q1}} is your primary platform?', displayIf: { q: 'Q1', op: 'nin', values: ['none'] }, options: [
      { code: 'aws', label: 'Platform A' }, { code: 'az', label: 'Platform B' }, { code: 'gcp', label: 'Platform C' }, { code: 'oci', label: 'Platform D' }, { code: 'priv', label: 'Private cloud' }] },
    { id: 'Q3', block: 'Current stack', type: 'numeric', min: 0, max: 100, text: 'Roughly what percentage of workloads run in the cloud?' },
    { id: 'Q4', block: 'Priorities', type: 'matrix', text: 'How important is each capability when choosing a cloud security vendor?', rows: [
      { code: 'posture', label: 'Posture management' }, { code: 'identity', label: 'Identity & access' }, { code: 'workload', label: 'Workload protection' }, { code: 'data', label: 'Data security' }],
      options: [{ code: '1', label: 'Not important' }, { code: '2', label: 'Somewhat' }, { code: '3', label: 'Important' }, { code: '4', label: 'Critical' }] },
    { id: 'Q5', block: 'Priorities', type: 'ranking', text: 'Rank these purchase drivers from most to least important.', options: [
      { code: 'price', label: 'Total cost' }, { code: 'int', label: 'Integration with existing tools' }, { code: 'sup', label: 'Vendor support' }, { code: 'comp', label: 'Compliance coverage' }] },
    { id: 'Q6', block: 'Budget', type: 'single', text: 'How will your cloud security budget change next year?', options: [
      { code: 'up', label: 'Increase' }, { code: 'flat', label: 'Stay the same' }, { code: 'down', label: 'Decrease' }] },
    { id: 'Q7', block: 'Budget', type: 'numeric', min: 1, max: 100, text: 'By roughly what percentage will it increase?', displayIf: { q: 'Q6', op: 'eq', value: 'up' } },
    { id: 'Q8', block: 'Budget', type: 'text', required: false, text: 'What is driving the decrease?', displayIf: { q: 'Q6', op: 'eq', value: 'down' } },
    { id: 'Q9', block: 'Advocacy', type: 'nps', min: 0, max: 10, text: 'How likely are you to recommend your current primary security vendor to a colleague?' },
    { id: 'Q10', block: 'Advocacy', type: 'text', required: false, text: 'What is the main reason for your score of {{Q9}}?' },
    { id: 'Q11', block: 'Advocacy', type: 'rating', min: 1, max: 5, text: 'Overall, how satisfied are you with your current setup?' },
    { id: 'Q12', block: 'Advocacy', type: 'single', text: 'As someone with no involvement, who makes these decisions?', displayIf: { q: 'S3', op: 'eq', value: 'no' }, options: [
      { code: 'cio', label: 'CIO / CTO' }, { code: 'ciso', label: 'CISO' }, { code: 'it', label: 'IT team' }] },
    { id: 'END', block: 'Close', type: 'info', text: 'Thank you. Your responses have been recorded (demo).' },
  ],
  rules: [
    { id: 'r1', after: 'S1', when: { q: 'S1', op: 'eq', value: 'none' }, action: { terminate: 'screenout' } },
    { id: 'r2', after: 'S3', when: { q: 'S3', op: 'in', values: ['minor', 'no'] }, action: { terminate: 'screenout' } },
    { id: 'r3', after: 'S4', when: { q: 'S4', op: 'eq', value: 'mr' }, action: { terminate: 'screenout' } },
    { id: 'r4', after: 'Q1', when: { q: 'Q1', op: 'eq', value: 'none' }, action: { terminate: 'screenout' } },
    { id: 'r5', after: 'Q6', when: { q: 'Q6', op: 'eq', value: 'flat' }, action: { goto: 'Q9' } },
    { id: 'r6', after: 'S3', when: { q: 'S3', op: 'eq', value: 'ceo' }, action: { goto: 'Q4' } },
  ],
  quotas: [
    { id: 'qt1', label: 'Company 1–99', when: { q: 'S2', op: 'eq', value: 'xs' }, target: 96, count: 71 },
    { id: 'qt2', label: 'Company 100–999', when: { q: 'S2', op: 'eq', value: 'md' }, target: 128, count: 102 },
    { id: 'qt3', label: 'Company 1000+', when: { q: 'S2', op: 'eq', value: 'lg' }, target: 96, count: 88 },
    { id: 'qt4', label: 'Final decision-makers', when: { q: 'S3', op: 'eq', value: 'final' }, target: 160, count: 117 },
  ],
  languages: {
    de: { S1: 'Welche Aussage beschreibt Ihren aktuellen Beschäftigungsstatus am besten?', S2: 'Wie viele Mitarbeiter hat Ihr Unternehmen weltweit?', S3: 'Welche Rolle spielen Sie bei Entscheidungen über Cloud-Sicherheitsprodukte?' },
  },
};
