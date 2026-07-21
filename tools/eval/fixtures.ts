/**
 * Retrieval evaluation fixtures (PLAN.md Phase 4): a synthetic multi-page
 * document with known content, plus questions with expected source pages.
 * Lexical questions exercise the full-text arm honestly; `verbatim` questions
 * reuse chunk text so the deterministic fake embeddings also produce a
 * meaningful vector-arm signal. Semantic paraphrase quality can only be
 * evaluated with real embeddings (AI_PROVIDER=azure).
 */

export interface EvalPage {
  page: number;
  title: string;
  body: string;
}

export interface EvalQuestion {
  id: string;
  question: string;
  /** null = unanswerable from the fixture document (refusal expected). */
  expectedPage: number | null;
  /** True when the question reuses source wording (vector arm testable with fake embeddings). */
  verbatim: boolean;
}

export const EVAL_DOCUMENT_PAGES: EvalPage[] = [
  {
    page: 1,
    title: 'Financial Summary',
    body: 'The consolidated revenue for the fiscal year reached 48 million euro, an increase of twelve percent over the prior year.',
  },
  {
    page: 2,
    title: 'Cost Structure',
    body: 'Operating costs remained flat because logistics contracts were renegotiated and warehouse automation reduced manual handling.',
  },
  {
    page: 3,
    title: 'Invoices',
    body: 'The largest outstanding invoice INV-2024-0042 totals 1250 euro and is due at the end of March.',
  },
  {
    page: 4,
    title: 'Workforce',
    body: 'Employee onboarding requires a signed contract, a laptop request and completion of the security awareness training.',
  },
  {
    page: 5,
    title: 'Sustainability',
    body: 'Carbon emissions decreased by eight percent after the delivery fleet switched to electric vehicles.',
  },
];

export const EVAL_QUESTIONS: EvalQuestion[] = [
  {
    id: 'q1-revenue-verbatim',
    question:
      'The consolidated revenue for the fiscal year reached 48 million euro, an increase of twelve percent over the prior year.',
    expectedPage: 1,
    verbatim: true,
  },
  {
    id: 'q2-revenue-lexical',
    question: 'consolidated revenue fiscal year increase',
    expectedPage: 1,
    verbatim: false,
  },
  {
    id: 'q3-costs',
    question: 'why did operating costs remain flat',
    expectedPage: 2,
    verbatim: false,
  },
  {
    id: 'q4-invoice-identifier',
    question: 'what is the total of INV-2024-0042',
    expectedPage: 3,
    verbatim: false,
  },
  {
    id: 'q5-onboarding',
    question: 'what does employee onboarding require',
    expectedPage: 4,
    verbatim: false,
  },
  {
    id: 'q6-sustainability',
    question: 'carbon emissions electric vehicles decrease',
    expectedPage: 5,
    verbatim: false,
  },
  {
    id: 'q7-training',
    question: 'security awareness training completion',
    expectedPage: 4,
    verbatim: false,
  },
  // Unanswerable (PLAN.md Phase 10: refusal correctness measured separately).
  {
    id: 'q8-unanswerable-space',
    question: 'what is the launch date of the Mars mission',
    expectedPage: null,
    verbatim: false,
  },
  {
    id: 'q9-unanswerable-hr',
    question: 'how many vacation days do employees in Japan get',
    expectedPage: null,
    verbatim: false,
  },
];
