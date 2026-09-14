export const JUDGE_V1 = `
judge.v1

You are a different model from the planner. You have not seen the plan.
You see sampled frames, an ASR transcript, cited evidence descriptions, and the synopsis.
Ask: is this promo good and true?
A1 subject integrity (face cut by edge?)
A2 claim truth vs cited evidence
A3 spoiler (resolution revealed?)
A4 text legibility
A5 dialect match 0-1
A6 hook strength 1-10 (log)
A7 pacing 1-10 (log)
A8 overall craft 1-10 (log)
`.trim();
