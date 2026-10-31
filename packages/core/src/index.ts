// @sampledge/core: domain constants, types and pure logic shared by web and API.
export * from './survey/engine';
export { cloudSurvey } from './survey/demo-survey';
export { cxSurvey, cxResponses } from './survey/demo-cx';
export * from './roles';
export * from './pricing';
export * from './analytics';
export * from './utils';
export {
  countries, countryByCode, opsStages, lifecycle, lifecycleToOps, crmStages, DEMO_NOW,
  months, monthlyRevenue, monthlyCost, monthlyForecast, dailyCompletes, dailyIR, panels, agents as agentDefs, team,
} from './demo/data';
export type { Country, Vendor, Project, Quota, Opportunity, SurveySummary, PanelBrand, OpsStage, LifecycleStage, CrmStage } from './demo/data';
/** Seed records. Only the API seed script should import these. */
export * as seed from './demo/data';
export * from './methods';
export * from './extract';
export * from './results';
export * from './dp';
