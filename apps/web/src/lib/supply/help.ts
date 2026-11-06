/**
 * Help text behind the "i" buttons on SUPPLY360 screens. Edit the words here; no code changes needed.
 *
 * Each screen has:
 *   what     what the screen is for, in one or two sentences
 *   how      the steps to use it
 *   where    where it fits in the day's work, and when to come here
 *   related  slugs of screens people usually go to next
 *   sections help for the panels on the screen, keyed by the panel's title or its small label above
 *            the title (exactly as shown on screen, without upper-casing)
 *
 * `shared` holds sections that appear on several screens (panel cockpits, profiling studios).
 * Keep sentences short and plain: people read these in the middle of a task.
 */
export type HelpEntry = { what: string; how?: string[]; where?: string; related?: string[] };
export type ScreenHelp = HelpEntry & { sections?: Record<string, HelpEntry> };

const panelSections: Record<string, HelpEntry> = {
  Funnel: { what: 'How many members get from sign-up to verified, profiled and active in the last 30 days.', how: ['Read left to right; the biggest drop is where to act first.'] },
  'Joins and churn': { what: 'New members against members who went dormant or left, week by week.', how: ['When the churn line crosses joins, the panel is shrinking.'] },
  'Where members come from': { what: 'Recruitment sources in the last 30 days, with what each costs and how good its members turn out.' },
  'Click-through by position': { what: 'How often members open a survey card depending on where it sits on their dashboard.', how: ['Use it to decide which surveys get the top slots.'] },
  'Tier pyramid': { what: 'How many members sit in each loyalty tier.' },
  'Earned vs redeemed (millions of points)': { what: 'Points members earned against points they cashed out, month by month.', how: ['Earned well above redeemed means the liability is growing.'], related: ['rewards'] },
  'Healthcare professionals by specialty and country': { what: 'Where the panel has doctors and nurses by specialty, so you know which healthcare requests it can serve.' },
  'Credential checks waiting': { what: 'Healthcare professionals whose licence or registry check is not finished yet. They cannot take professional surveys until it is.', related: ['registration'] },
  Attributes: { what: 'The profile questions in this studio. Pick one to edit its wording, answers and rules.' },
  Question: { what: 'The selected profile question: wording, answer options and who is asked it.', how: ['Changes create a new version; members who already answered keep their answer.'] },
  'Respondent preview': { what: 'How the question looks to a member on a phone.' },
  'Answered, by country': { what: 'Share of active members who have answered this question, per country. Low coverage limits targeting.', related: ['profile-automation'] },
  Versions: { what: 'Every published version of the question, who changed it and when.' },
  'Free-text job titles → normalised roles': { what: 'Job titles members typed, matched to standard roles so B2B targeting works.', how: ['Accept or correct the suggested role for each title.'] },
  'Specialties and sub-specialties': { what: 'The medical specialty list used for healthcare targeting.' },
  'Registry checks by country': { what: 'Which professional registries are used to verify healthcare members in each country, and their pass rates.' },
};

export const shared: Record<string, HelpEntry> = panelSections;

export const help: Record<string, ScreenHelp> = {
  executive: {
    what: 'The supply command view: how big and healthy the panels are, what is in fieldwork right now, and the decisions waiting on you.',
    how: ['Scan the top tiles for anything red.', 'Open “Needs your decision” and clear it.', 'Click any request or market to drill into it.'],
    where: 'Start your day here; every other screen is one click away.',
    related: ['quotas', 'redemptions', 'sampleon'],
    sections: {
      'From registered to reachable today': { what: 'How many members are registered, verified, consented, active and reachable today. Reachable is what you can actually invite.' },
      'Fieldwork flight deck': { what: 'Every audience request in field or soft launch, with its pace against target.', how: ['Click a row to see its quotas, batches and events.'] },
      'Validated completes by hour': { what: 'Completes that passed quality checks, hour by hour over the last 24 hours (UTC).' },
      'Reachable today': { what: 'The ten countries with the most members you can invite today.' },
      'Signals this week': { what: 'Quality and fraud signals raised this week: speeders, duplicates, risky redemptions.', related: ['quality-risk'] },
      'Service levels': { what: 'How quickly support replies and resolves members’ tickets against target.', related: ['support'] },
      'Just happened': { what: 'The latest events across the panels, newest first.' },
      'Needs your decision': { what: 'Approvals waiting on you, such as payouts, launches and role changes.', how: ['Approve or reject each one; nothing happens until someone decides.'] },
    },
  },
  'global-intelligence': {
    what: 'Where members and survey activity are in the world, on a globe or a flat map, with a ranked list carrying the same numbers.',
    how: ['Pick a measure (members, reachable, completes…) and a region.', 'Click a country for its panel mix, local time and requests in field.', 'Switch to 2D if the globe is slow or you prefer a list.'],
    where: 'Use it before promising a multi-country study, or to see where fieldwork is happening now.',
    related: ['distribution', 'feasibility'],
    sections: { Ranked: { what: 'Countries ranked by the selected measure. Same numbers as the map, easier to compare.' } },
  },
  copilot: {
    what: 'Ask questions about your panels in plain language and get answers you can check, plus suggested actions.',
    how: ['Type a question or pick a starter, such as “quotas behind pace”.', 'Each answer links to the screen where you can verify the number.', 'Suggested actions wait in the tray; medium and high-risk ones ask for confirmation.'],
    where: 'Use it when you don’t know which screen holds the answer.',
    sections: {
      Ask: { what: 'Ask in your own words, about counts, quotas, countries, panels, rewards or a request id.', how: ['Try “How many nurses in the UK on MyHealthOpinions?”', 'Follow-up questions keep the context chips.'] },
      'Needs your approval': { what: 'Actions the copilot suggested. Nothing runs until you approve it.' },
      Context: { what: 'Filters the copilot keeps for follow-up questions, such as a panel or country.', how: ['Remove a chip to widen the next answer.'] },
    },
  },
  analytics: {
    what: 'Build your own reports: pick a measure and how to split it, check the numbers in a pivot, then save, schedule or export.',
    how: ['Choose a metric, then rows and columns.', 'Filter panels and pick a chart.', 'Save it to the gallery, schedule it to e-mail, or download a CSV.'],
    where: 'For recurring reporting to clients and leadership.',
    sections: { 'Schedule and export': { what: 'Send this report by e-mail on a schedule, or download the pivot as CSV.', how: ['Add at least one recipient to schedule it.'] } },
  },
  notifications: {
    what: 'Everything that needs you, sorted into Act, Review and FYI.',
    how: ['Clear the Act lane first.', 'Open an item to deal with it, mark it Done, or snooze it.', 'Set below which kinds of notification reach you by e-mail, Slack or phone.'],
    where: 'Check it a few times a day; the bell in the top bar shows the count.',
    sections: {
      Act: { what: 'Needs a decision from you, such as an approval or a quota at risk.' }, Review: { what: 'Someone is waiting for you to look at something.' }, FYI: { what: 'Good to know; nothing to do.' },  'Where each kind of notification goes': { what: 'Your delivery rules: which sources reach you on which channel, or go into the daily digest instead.', how: ['Act items always appear in the app, whatever you choose.'] } },
  },
  turn2opinion: { what: 'The Turn2Opinion consumer panel: membership, recruitment, survey card performance, loyalty and points.', how: ['Read the funnel and churn first, then where members come from.'], where: 'Use it for panel health reviews and recruitment planning.', related: ['panellists', 'profile-automation'] },
  myfrequentrewards: { what: 'The MyFrequentRewards panel: a rewards-first consumer panel. Same views as the other cockpits, with more weight on points and redemptions.', where: 'Use it for panel health reviews and to watch the points economy.', related: ['rewards', 'redemptions'] },
  myhealthopinions: { what: 'The MyHealthOpinions panel of healthcare professionals and patients, including specialties and credential checks.', where: 'Use it before accepting healthcare requests, and to clear credential checks.', related: ['profiling/healthcare', 'registration'] },
  panellists: {
    what: 'Every panel member across the three panels, searchable and filterable. Members appear by pseudonymous handle only.',
    how: ['Filter by panel, status, segment or country.', 'Click a member to open their full profile.', 'Select several to act on them together.'],
    where: 'Your starting point for anything about specific members.',
    related: ['panellists/profile', 'activity'],
  },
  'panellists/profile': {
    what: 'One member, everything about them: profile, consents, surveys taken, points and quality history.',
    how: ['Use the Operate panel to adjust points, suspend or send a message; each action is logged.'],
    where: 'Open it from the database, a support ticket or a quality case.',
    sections: { Operate: { what: 'Actions on this member. Each one asks for a reason and goes into the audit log.' } },
  },
  registration: {
    what: 'How sign-ups become verified members: the funnel, identity checks and the manual review queue.',
    how: ['Work through the review queue: approve, reject or ask for more information.', 'Tune the automatic rules if pass rates look wrong.'],
    where: 'Check the queue daily; members can’t take surveys until verified.',
    sections: {
      'Review queue': { what: 'Sign-ups the automatic checks could not decide. Each one waits for a person.' },
      'Pass rates': { what: 'How many sign-ups each automatic rule passes, by panel.' },
    },
  },
  'profile-automation': {
    what: 'Find the profile questions members haven’t answered and fill the gaps automatically with short nudges.',
    how: ['Pick a red cell in the gap map: an attribute and a panel.', 'Start a nudge campaign for it.', 'Watch completion rise in the lift chart.'],
    where: 'Use it when targeting fails because members haven’t answered a question.',
    related: ['feasibility', 'profiling/demographic'],
    sections: {
      Nudge: { what: 'A nudge for the selected gap: who gets it, the question, and the expected lift.', how: ['Start it to ask those members the missing question.'] },
      'Pick a cell to target it': { what: 'Share of active members missing each attribute, by panel. Darker means a bigger gap.', how: ['Click a cell to plan a nudge for it.'] },
      'Nudge campaigns': { what: 'Campaigns asking members to answer missing questions, and how they are doing.' },
      'Progressive profiling rules': { what: 'Always-on rules that ask one missing question at a time, for example after a survey.' },
      'Avg. profile completion': { what: 'Average profile completion over time, to see whether the nudges work.' },
    },
  },
  'profiling/demographic': { what: 'Design and maintain the demographic profile questions: age, gender, household, income and so on.', how: ['Pick an attribute, edit it, preview it, then publish a new version.'], where: 'Change questions here, then use them in segmentation and feasibility.', related: ['segmentation'] },
  'profiling/b2b': { what: 'Business profile questions: job title, industry, company size and decision role. Free-text job titles are matched to standard roles.', how: ['Review unmatched job titles in the taxonomy mapper.'], where: 'Keep it tidy before B2B studies.', related: ['segmentation'] },
  'profiling/healthcare': { what: 'Healthcare profile questions: specialties, conditions and professional credentials.', how: ['Check registry pass rates by country before accepting healthcare requests.'], where: 'Health answers only leave SUPPLY360 as match / no match.', related: ['myhealthopinions'] },
  'quality-risk': {
    what: 'Fraud, duplicates, speeders and account health in one place, with cases to review.',
    how: ['Work through open cases: clear, warn or suspend.', 'Tune a rule and see last month’s backtest before saving.'],
    where: 'Check daily; held redemptions often start here.',
    related: ['redemptions', 'panellists/profile'],
    sections: {
      'Selected case': { what: 'The evidence for this member’s case.', how: ['Clear it, warn the member or suspend; each decision is logged.'] },
      'Risk radar': { what: 'Share of completes flagged, by signal type and panel.' },
      Cases: { what: 'Members whose activity tripped a rule. Each one needs a decision.' },
      'Rule tuning · backtest on last month': { what: 'Try a different threshold and see how many members it would have flagged last month, before you change it.' },
    },
  },
  activity: { what: 'Every event across members in time order: sign-ups, surveys, points, support, quality.', how: ['Filter by panel, type or member, and drag the time window.'], where: 'Use it to answer “what happened to this member?” or “what changed at 3pm?”', sections: { 'In the window': { what: 'Events inside the selected time window, newest first.' } } },
  segmentation: {
    what: 'Build an audience with nested filters or a plain-language description, and see live counts as you go.',
    how: ['Describe the audience or add rules (AND / OR).', 'Check the count and charts on the right.', 'Save it to reuse, or send it to feasibility.'],
    where: 'Before feasibility or a campaign.',
    related: ['feasibility', 'email'],
    sections: { Rules: { what: 'The audience definition. Each rule narrows or widens the count.' }, 'Reuse a definition': { what: 'Saved audiences you can load and adapt.' } },
  },
  feasibility: {
    what: 'Will this audience deliver, and how fast? Eligible, reachable and expected completes by country.',
    how: ['Set the audience, incidence rate, survey length and completes needed.', 'Read the shortfall by country.', 'Change dates or countries until it is feasible.'],
    where: 'Before you accept a request or promise a client a number.',
    related: ['sampleon', 'distribution'],
    sections: { 'By country': { what: 'Eligible, reachable and expected completes per country, with the shortfall.' } },
  },
  distribution: {
    what: 'Where the reachable audience is by country and panel, and which markets are awake right now.',
    how: ['Slide the hour to see which markets are inside their send window.', 'Use the send planner to find the best hour to start a batch.'],
    where: 'Use it when planning batches across time zones.',
    related: ['batches'],
    sections: {
      Map: { what: 'Reachable members by country, with markets outside their send window dimmed.', how: ['Move the hour slider to see who is awake.'] },
      'Send planner': { what: 'The best UTC hour to send so the most of your audience is awake (08:00 to 21:00 local).' },
      'Each market’s day against UTC': { what: 'Each market’s local day lined up against UTC, so you can see overlap.' },
      'Audience by country and panel': { what: 'How each country’s reachable audience splits across the three panels.' },
    },
  },
  surveys: { what: 'Every survey members can take, from PROJEXA, ZAPX and our own programmes, with quotas and status.', how: ['Filter by source or status; open a survey for its quota cells.'], where: 'Use it to see what is live and what each member could be offered.', related: ['quotas', 'launch'], sections: { 'Quota cells': { what: 'This survey’s quota cells and how full each one is.' } } },
  'survey-generation': {
    what: 'Draft a profiling or engagement survey with AI. Every question comes with the reason it was included.',
    how: ['Describe the topic, audience, goal and length.', 'Generate, then edit, redraft or remove questions.', 'Send the draft to Survey Studio for review; nothing is published from here.'],
    where: 'For our own panel surveys, not client questionnaires.',
    sections: {
      Draft: { what: 'The generated questions. Each one shows why it was included.', how: ['Edit, redraft or remove a question.'] },
      'What should it find out?': { what: 'The brief the draft is written from.' },
      'Quality checks': { what: 'Length, attention check, open questions and mobile-friendly lists, checked on the draft.' },
      'Review in Survey Studio': { what: 'The next step: a person reviews and programmes the draft.' },
    },
  },
  'weekly-rewards': { what: 'The recurring weekly survey programme that keeps members active between client studies.', how: ['Pick a week’s slot and choose its template.', 'Watch uptake and cost per complete.'], where: 'Plan it a week ahead.', sections: {
      'Selected week': { what: 'The week you picked: its survey, status and numbers.' },  'Uptake and cost per complete': { what: 'How many members take the weekly surveys and what each complete costs in points.' }, Templates: { what: 'Ready-made weekly surveys to reuse.' } } },
  routing: {
    what: 'How members move from one survey to the next when they screen out or a quota fills, so they get another chance instead of a dead end.',
    how: ['Pick a routing strategy and compare its flows.', 'Click a survey to see its eligibility checks in order.'],
    where: 'Use it when screen-outs are high or members complain of dead ends.',
    sections: {
      'This strategy, per hour': { what: 'What the selected strategy produces each hour: members routed, completes and revenue.' },
      Strategies: { what: 'The rules the router can use, such as best earnings or best fit, and what each would change.' },
      'Eligibility checks, in order': { what: 'The checks a member passes before being offered this survey, in the order they run.' },
      'Flows per hour by survey': { what: 'The same numbers as the flow graph, as a table.' },
    },
  },
  launch: {
    what: 'Launch a survey safely: a small soft launch first, check the read-out, then scale to full launch.',
    how: ['Run the soft launch.', 'Check incidence, length and drop-off against plan.', 'When the checklist passes, open the gate and launch fully.'],
    where: 'Every new survey goes through here before full fieldwork.',
    related: ['batches', 'quotas'],
    sections: { Checklist: { what: 'What must be true before full launch. The gate stays closed until every item passes.' }, 'Soft-launch read-out': { what: 'How the soft launch performed against plan.' }, 'Full launch': { what: 'Open the gate and send the full volume.' } },
  },
  batches: { what: 'Plan invitation waves by time zone, so each market is invited in its send window.', how: ['Pick a survey, then drag or add batches on the timeline.', 'Batches outside 08:00 to 21:00 local are blocked.'], where: 'After launch, to pace fieldwork.', related: ['distribution', 'quotas'], sections: { 'Selected batch': { what: 'The batch you picked: market, survey, size and time.', how: ['Move it inside the market’s send window, or cancel it.'] }, } },
  quotas: {
    what: 'Every quota cell across live surveys: on pace, at risk or full.',
    how: ['Sort by pace to find the cells at risk.', 'Add a batch, widen targeting or close a cell.', 'Set automatic rules for what happens when a cell fills.'],
    where: 'Check during fieldwork, at least daily.',
    related: ['batches', 'launch'],
    sections: { 'Burn-up and projection': { what: 'Completes so far and where they are heading by the deadline.' }, 'Watch-list': { what: 'Cells most at risk of missing their target.' }, Rules: { what: 'Automatic actions, such as closing a cell when it fills.' } },
  },
  sampleon: {
    what: 'SampAudience audience requests from PROJEXA projects and ZAPX surveys, from feasibility to closed, with the panel allocation.',
    how: ['Pick a request in the pipeline.', 'Check feasibility, set the panel split (points of 100) and approve it.', 'Watch quotas, batches and events once it is live.'],
    where: 'Where supply staff approve and run every connected request.',
    related: ['projexa-requests', 'zapx-requests', 'feasibility'],
    sections: {
      'Selected request': { what: 'The request you picked: its feasibility, panel split, quotas, batches and events.', how: ['Use the tabs; approving the allocation sends it to SampAudience and asks you to confirm.'] },
      Pipeline: { what: 'Every request by stage: submitted, feasibility ready, approved, soft launch, live and closed.', how: ['Filter by source or search, then click a card to open it below.'] },
      'Panel allocation': { what: 'How the request’s completes split across the three panels, in points of 100.', how: ['Use “Split by reach” for a sensible start; health requests should stay on MyHealthOpinions.'] },
      'Recorded in SUPPLY360': { what: 'Real totals from SUPPLY360: survey cards placed, outcomes received and reward points credited.' },
    },
  },
  'projexa-requests': {
    what: 'Audience requests raised by PROJEXA projects: what the project manager asks for, the budget and the quotas.',
    how: ['Accept, counter-propose with a reason, or decline.', 'Accepted requests move to SampAudience for allocation.'],
    where: 'Check the inbox daily; project managers are waiting on an answer.',
    related: ['sampleon'],
    sections: {
      'Selected request': { what: 'The project’s ask: milestones, terms, budget and quotas.', how: ['Accept (you can undo for 8 seconds), counter-propose or decline.'] },  'Request terms': { what: 'What the project asks for, and your counter-proposal side by side.' }, Budget: { what: 'The cost at the asked price per complete.' }, 'Quota mapping': { what: 'How the project’s quotas map to SUPPLY360 profile questions.' } },
  },
  'zapx-requests': { what: 'Audience requests raised directly from ZAPX surveys, with or without a PROJEXA project.', how: ['Check the survey preview and QA results.', 'Test the redirects.', 'Approve the launch once every QA check passes.'], where: 'Launch stays locked until QA passes; the lock says which check failed.', related: ['sampleon'], sections: { 'Request card': { what: 'One ZAPX request: the survey preview, QA checks and redirects.', how: ['Test the redirects, then approve the launch once QA passes.'] }, } },
  automation: {
    what: 'Build engagement workflows from blocks: a trigger, conditions, delays and actions.',
    how: ['Pick a workflow or start a new one.', 'Drag blocks from the palette and connect them.', 'Fix the issues listed under “Before activating”, then activate.'],
    where: 'For anything that should happen automatically, such as a win-back after 60 days.',
    related: ['journeys', 'email'],
    sections: {
      Workflows: { what: 'All engagement workflows. Pick one to edit it.' }, Workflow: { what: 'The selected workflow as connected blocks.', how: ['Click a block to edit it; drag from the palette to add one.'] },  'Add a block': { what: 'Blocks you can add: triggers, conditions, delays and actions.' }, 'Before activating': { what: 'Problems that must be fixed before the workflow can run.' }, 'Execution log': { what: 'Recent runs and what each one did.' } },
  },
  email: {
    what: 'Design a campaign, choose who gets it, test subject lines and pick the send time.',
    how: ['Build the content from blocks.', 'Choose the audience and an optional A/B subject test.', 'Pick a send time and clear the “Before sending” checks.'],
    where: 'For one-off campaigns; recurring ones belong in newsletters.',
    sections: {
      'Live preview': { what: 'How the e-mail looks to a member.' },  Content: { what: 'The blocks that make up the e-mail.' }, Audience: { what: 'Who receives it. Members without consent or over the weekly cap are left out.' }, 'A/B test': { what: 'Send a second subject line to part of the audience and keep the better one.' }, 'Send time': { what: 'One fixed hour, or each member’s best hour.' }, 'Before sending': { what: 'Problems that block sending, such as a missing unsubscribe link.' } },
  },
  newsletters: { what: 'Recurring panel newsletters, built from a library of stories.', how: ['Pick an issue, drag in stories, preview and schedule.'], where: 'Plan each issue a week ahead.', sections: {
      'Selected issue': { what: 'The newsletter issue you picked, its stories and schedule.' },  'Content library': { what: 'Stories you can reuse across issues.' } } },
  journeys: { what: 'How members move from sign-up to loyal respondent, and where each panel loses them.', how: ['Click a stage to see who reached it, by panel.', 'Start with the biggest gap.'], where: 'Use it to decide where engagement work will pay off.', related: ['automation'], sections: { 'Stage detail': { what: 'Who reached this stage, by panel.' }, 'Biggest gap': { what: 'The step where the most members drop out.' } } },
  rewards: {
    what: 'What we owe members in points, every points movement in order, and whether payouts match what providers say they paid.',
    how: ['Read the liability by panel.', 'Search the ledger by member or reference.', 'Explain any reconciliation difference.'],
    where: 'Finance and panel managers use it monthly and before audits. Balances are never edited here.',
    related: ['redemptions'],
    sections: { 'Points ledger': { what: 'Every points entry, newest first. Entries can’t be edited; corrections are new entries.' }, 'Payout reconciliation': { what: 'Our payouts against each provider’s statement this month. Differences need an explanation.' } },
  },
  redemptions: { what: 'Approve, hold or reject members’ payout requests, with the risk signals for each.', how: ['Work through the queue from the highest risk.', 'Approve, hold or reject; each decision is logged.'], where: 'Check daily so members are paid on time.', related: ['quality-risk', 'rewards'], sections: {
      'Selected redemption': { what: 'One payout request with its risk signals.', how: ['Approve, hold or reject; a reason is recorded.'] },  'This session': { what: 'Decisions you made since opening the screen.' } } },
  support: { what: 'Members’ support tickets, with their profile and recent points next to each one.', how: ['Pick a ticket, read the member’s context, reply or resolve.'], where: 'Work the queue against the service-level targets.', related: ['support-ai'], sections: {
      'Selected ticket': { what: 'The member’s message and the conversation so far.', how: ['Reply, use a suggested answer, or resolve. Points fixes are made as ledger adjustments.'] },  Member: { what: 'Who raised the ticket (by handle) and their status.' }, 'Recent ledger rows': { what: 'The member’s latest points entries; most tickets are about points.' } } },
  'support-ai': { what: 'Replies drafted by AI for common tickets, waiting for a person to review.', how: ['Accept, edit or reject each draft.', 'Turn on auto-send only for categories with a high acceptance rate.'], where: 'Use it to clear routine tickets quickly.', sections: {
      'This session': { what: 'Drafts you reviewed since opening the screen.' },  'Review lane': { what: 'Drafts waiting for review.' }, 'What reviewers did': { what: 'How often drafts were accepted, edited or rejected in the last 30 days.' }, 'Auto-send': { what: 'Categories whose drafts are sent without review.' } } },
  'api-hub': {
    what: 'Every system SUPPLY360 talks to, how healthy each link is, the events we send, and the keys that can call us.',
    how: ['Click a connection on the map for its details.', 'Retry failed event deliveries.', 'Create or revoke API keys.'],
    where: 'For admins, when an integration misbehaves or a partner needs access.',
    sections: {
      'Selected connection': { what: 'Details of the connection picked on the map: direction, latency, traffic, errors and how it signs in.' },
      'SUPPLY360 and what it talks to': { what: 'Each connected system, coloured by health. Moving dashes show traffic.' },
      'Event deliveries': { what: 'Events SUPPLY360 sends to other systems. Failed ones can be retried; receivers ignore duplicates.' },
      'API keys': { what: 'Keys that let other systems call SUPPLY360. A new key’s secret is shown once.' },
      'Configured on the API server': { what: 'What is actually set up on the server. Secrets are only shown as set or missing.' },
    },
  },
  roles: {
    what: 'Who can see and do what in SUPPLY360.',
    how: ['Change cells in the matrix, then review and save the changes.', 'Add a temporary override for one person, with a reason.'],
    where: 'For admins. Panellist identity is never visible to any role.',
    sections: { 'Per-person overrides': { what: 'Temporary extra access for one person. It needs a reason and expires within 30 days.' }, 'People in this workspace': { what: 'Everyone who can sign in, and their role. Making someone an admin needs another admin’s approval.' } },
  },
  settings: {
    what: 'Workspace-wide rules: send windows, invitation caps, rewards, quality and privacy.',
    how: ['Search or pick a section.', 'Change values; unsaved changes are marked.', 'Save. Changes with wide impact show a preview and ask to confirm.'],
    where: 'For admins. Settings owned by Finance or the reward policy are changed there.',
    sections: {
      Workspace: { what: 'The workspace name and the time zone reports use.' }, Locales: { what: 'Default language for members, and the currency reward values are shown in.' }, Invitations: { what: 'When and how often members can be invited: send window, weekly cap, and who counts as active.' }, Rewards: { what: 'Point value, minimum payout, expiry and when redemptions are held for review.' }, Quality: { what: 'When a complete counts as speeding, and whether repeat offenders are suspended automatically.' }, Privacy: { what: 'How long closed accounts are kept, and how health data may leave SUPPLY360.' }, Limits: { what: 'How many requests an API key may make per minute.' },  Audit: { what: 'Recent setting changes: who changed what, from and to.' } },
  },
  guide: {
    what: 'Every SUPPLY360 screen in one list, grouped like the sidebar, with what each one is for and when to use it.',
    how: ['Search for a task, such as “payout” or “quota”.', 'Open a screen from its name, or press its i for the steps.'],
    where: 'Start here if you are new, or when you are not sure which screen does what.',
  },
  'theme-studio': {
    what: 'Choose how SUPPLY360 looks for you: theme, density, text size and motion.',
    how: ['Pick a theme and check the live preview.', 'Adjust comfort settings. They are saved to your profile.'],
    where: 'Any time; it only changes your own view.',
    sections: {
      'Live preview': { what: 'Buttons, tables and charts in the theme you picked, before you switch.' },  'Choose a theme': { what: 'Six themes, all checked for contrast.' }, 'Comfort settings': { what: 'Density, text size and reduced motion.' }, 'Contrast check': { what: 'Contrast ratios of this theme’s colours against WCAG 2.2.' } },
  },
};

/** The help for a screen, by its slug ('panellists/[id]' pages use 'panellists/profile'). */
export const screenHelp = (slug: string) => help[slug];

/** Help for a section, looked up by the screen and the section's title or label. */
export function sectionHelp(slug: string | null, ...keys: (string | undefined)[]): HelpEntry | undefined {
  for (const k of keys) if (k && slug && help[slug]?.sections?.[k]) return help[slug]!.sections![k];
  for (const k of keys) if (k && shared[k]) return shared[k];
  return undefined;
}

/** The screen slug from a /supply path. */
export function slugFromPath(path: string | null): string | null {
  if (!path?.startsWith('/supply/')) return null;
  const rest = path.slice('/supply/'.length).replace(/\/$/, '');
  if (/^panellists\/[^/]+$/.test(rest) && rest !== 'panellists/profile') return 'panellists/profile';
  return rest || null;
}
