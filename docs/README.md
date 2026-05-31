# Agentik — Frontend Design & Architecture

> Production-grade frontend design for an **Agentic AI System**: build, configure, monitor, and orchestrate fleets of AI agents that use tools, run workflows, call APIs, reason over memory, and collaborate.

**Audience:** developers, AI engineers, automation teams, product operators, DevOps.
**Stack:** Next.js (App Router) · React 19 · TypeScript (strict) · Tailwind CSS v4 · shadcn/ui · Radix · Zustand (client) · TanStack Query (server) · SSE + WebSocket (realtime) · Framer Motion (subtle).

This is a design-only repository. No application code is shipped here — these documents are the spec a senior frontend team implements against.

---

## Document map

| # | Document | Covers (from the brief) |
|---|----------|--------------------------|
| 00 | [Overview · Information Architecture · Navigation](./00-overview-ia-navigation.md) | 1. Product overview · 2. IA · 3. Main navigation |
| 01 | [Page-by-page UI design](./01-pages.md) | 4. Page-by-page UI (all 10 modules) |
| 02 | [Component hierarchy · Design tokens](./02-components-tokens.md) | 5. Component hierarchy · 6. Design system tokens |
| 03 | [Frontend architecture](./03-architecture.md) | 7. Architecture · folder structure · state · RBAC · security |
| 04 | [Data models · API contracts · Realtime events](./04-data-api-realtime.md) | 8. TS data models · 9. API contracts · 10. Realtime event schema |
| 05 | [UX flows · States · Accessibility · Performance](./05-ux-states-a11y-perf.md) | 11. UX flows · 12. Error/loading/empty · 13. A11y · 14. Performance |
| 06 | [Implementation roadmap](./06-roadmap.md) | 15. Roadmap |

---

## The product in one sentence

Agentik is the **control plane** for autonomous AI agents — a place where a developer designs an agent, wires it into a workflow, ships it, and then *watches it think* in real time, with full visibility into every decision, tool call, dollar, and failure, plus the controls to pause, retry, or approve any step.

## Five non-negotiable UX guarantees

The entire design is organized around making these always answerable at a glance:

1. **What is each agent doing right now?** → live status, current step, streaming reasoning.
2. **Why did it make this decision?** → reasoning summary attached to every action, linked to the prompt version that produced it.
3. **Which tools were called, with what, and what came back?** → expandable tool-call records with request/response and latency.
4. **What failed?** → first-class error states with the failing step, the error class, and the retry affordance inline.
5. **How much did it cost?** → token + dollar accounting on every run, step, agent, and team, never more than one click away.

## Reading order

Start at **00** for the mental model, skim **01** for the surface area, then **03 + 04** are the contract the implementation is built on. **02** is the kit, **05** is the polish, **06** is the plan.
