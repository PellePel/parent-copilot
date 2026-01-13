# Product Requirements Document

## Copilot: A Mental Model Builder for Co-Parents

**Version 1.0 (MVP) | December 18, 2025 | Draft for Review**

---

## Executive Summary

Copilot is an AI-powered tool designed to help partners distribute the mental load of parenting more equitably. Rather than being a reminder system or task manager, Copilot helps the less-informed parent build the same mental model the primary planner already has—enabling proactive conversations about what's coming up instead of reactive task execution.

---

## The Core Problem

In many families, one parent carries the full cognitive load of tracking, planning, and anticipating children's needs. The other parent is willing to help but lacks visibility into what needs thinking about and when. This creates an exhausting dynamic where one parent must constantly delegate, and the other remains perpetually reactive.

---

## The Solution

Copilot creates a shared mental model by:

- **Capturing** the primary planner's thinking (brain dumps, concerns, ideas)
- **Surfacing** context proactively to the other parent (daily digest)
- **Training** anticipation skills over time (learning patterns, building intuition)

---

## Success Criteria

- The less-informed parent initiates 2-3 planning conversations per week (that wouldn't have happened otherwise)
- The primary planner feels heard and experiences reduced mental load
- After 4 weeks, the less-informed parent starts anticipating needs without the app

---

## Problem Definition

### Who Is This For?

**Primary User: The "less-in-the-loop" parent**
- Wants to be more proactive but doesn't have visibility into what needs attention
- Willing to build a new habit (daily 2-3 min check-in)
- Goal: Have conversations about what's coming up before being told

**Secondary User: The "mental load carrier" parent**
- Currently tracks everything in their head
- Exhausted from constant delegation and having to remember to tell their partner
- Needs an easy way to externalize thoughts without additional organizational burden

### Core Insight

The primary planner isn't superhuman—they've just built a mental model through repetition. The app's job is to help the other parent build that same model.

### What Problem Are We Actually Solving?

**NOT solving:** "I forget to do tasks" → That's a reminder app

**NOT solving:** "I don't know what to do" → That's a delegation tool

**ACTUALLY solving:** "I don't know what to think about proactively"

- Lack of visibility into what's on the horizon
- No mental model of typical parenting rhythms and milestones
- No pattern recognition for "it's been X weeks since Y"
- Gap between willingness to help and knowing what needs help

---

## Product Vision

### North Star

Transform reactive helpers into proactive co-planners by building shared mental models.

### What Success Looks Like (12 months)

- Couples report more equitable distribution of mental load
- The less-informed parent anticipates needs independently
- Planning conversations happen naturally, not just when crises arise
- The app becomes training wheels that eventually aren't needed

### What This Is NOT

- Not a shared calendar (those already exist)
- Not a task management system (Todoist, etc.)
- Not a relationship counseling tool
- Not trying to replace communication—trying to enable better communication

---

## MVP Scope: The Simplest Thing That Could Work

### Core Hypothesis

If we give the primary planner an easy way to externalize their thinking, and give the other parent a daily digest of what's on the radar + relevant context, couples will have more proactive planning conversations.

### MVP Features (Week 1-2 Build)

#### 1. Brain Dump Interface (Primary Planner)

**Purpose:** Zero-friction capture of thoughts

**Features:**
- Text input (quick notes)
- Voice note recording (capture while driving, cooking, etc.)
- No categorization required
- No structure required
- Mobile-first design

#### 2. Daily Digest (Less-Informed Parent)

**Purpose:** Surface what deserves attention today

**Features:**
- Opens to "Today's Digest" by default
- Three sections:
  1. **Recent Mentions** (what partner has been thinking about)
  2. **Consider This Week** (AI-generated based on kids' ages/past patterns)
  3. **Coming Up Soon** (things with time sensitivity)

#### 3. Context Modal (Both Users)

**Purpose:** Provide background for informed conversations

Tap any digest item to see full context, why it matters, typical timeline, and conversation starter suggestions.

### What's Explicitly OUT of MVP

- Calendar integration
- Task assignments
- Reminders/notifications for specific tasks
- Sharing with extended family
- Multiple children management
- Historical tracking/journaling
- Analytics/insights dashboard

---

## Success Metrics

### North Star Metric

**Proactive Conversations Initiated** per week by less-informed parent

**Target:** 2-3 conversations/week that wouldn't have happened otherwise

### Supporting Metrics

**Engagement:**
- Daily active users (both parents)
- Brain dumps per week (primary planner)
- Digest open rate (less-informed parent)
- Context modal views

**Behavior Change:**
- Self-reported: "Did you have a conversation about this topic?" (in-app prompt)
- Time to first proactive conversation (days from signup)
- Retention at 2 weeks, 4 weeks

**Quality:**
- Primary planner: "Do you feel your partner is more aware?" (weekly survey)
- Less-informed parent: "Do you feel more confident initiating planning conversations?" (weekly survey)
- Net Promoter Score (monthly)

---

## Technical Architecture

### Stack Recommendations

- **Frontend:** React Native (mobile-first, cross-platform)
- **Backend:** Lightweight (Supabase or Firebase)
- **AI:** Claude API (Anthropic)
- **Voice:** Browser Speech-to-Text API or Deepgram
- **Database:** PostgreSQL (via Supabase) or Firestore
- **Auth:** Email-based

### AI Prompting Strategy

**Nightly Digest Generation**

- **Input:** All brain dumps from past 3 days + kids' ages
- **Output:** Themes/topics from dumps, age-appropriate considerations, timeline/urgency assessment, conversation starters

**Context Modal Generation**

- **Input:** Specific digest item + original brain dump (if applicable)
- **Output:** "Why this matters" explanation, typical timeline, conversation starter suggestion

---

## Design Principles

### 1. Friction-Free Capture

The primary planner should be able to brain dump in under 15 seconds. No forms, no categories, no structure required.

### 2. Context Over Commands

Don't tell people what to do—give them enough context to have informed conversations.

### 3. Train, Don't Replace

The goal is to build the user's intuition over time, not create permanent dependency on the app.

### 4. Conversational, Not Clinical

This is personal. The tone should feel like a helpful friend, not a management system.

### 5. Mobile-First

Parents are busy. This needs to work while waiting in line, sitting in the car, or during the 2-minute morning coffee.

---

## Go-to-Market Strategy

### Initial Launch: Private Beta

- **Target:** 5-10 couples who fit the profile
- **Recruitment:** Personal network, parenting forums (Reddit, local Facebook groups)
- **Goal:** Validate core hypothesis, gather qualitative feedback
- **Timeline:** 2 weeks of active use

### Success Criteria for Proceeding

- At least 3/5 couples report initiating more proactive conversations
- Primary planners say it's easy to use
- No major technical blockers
- Positive sentiment in weekly check-ins

### Content Strategy (Post-Launch)

Document learnings publicly:
- Blog post: "I built an app to help me be a better co-parent"
- Twitter thread: Key insights from user research
- GitHub repo: Open-source if valuable to community
- Tutorial: "How to build an AI-powered family app"

---

## Risks & Mitigation

### Risk 1: Primary Planner Adoption

**Risk:** If the primary planner doesn't use it, nothing works.

**Mitigation:**
- Make brain dump absurdly easy (voice, 15 sec)
- Explicitly frame as "this helps your partner stay in the loop"
- Show immediate value (partner actually brings things up)

### Risk 2: Less-Informed Parent Doesn't Build Habit

**Risk:** If they don't check daily, they miss context.

**Mitigation:**
- Push notification at ideal time (morning coffee)
- Keep digest short (2 min read max)
- Show progress: "You've checked in 5 days in a row!"

### Risk 3: Becomes Just Another To-Do List

**Risk:** Users treat it like task management, miss the point.

**Mitigation:**
- No task creation in MVP
- Explicitly coach: "This is about conversations, not tasks"
- UX design reinforces context over action items

---

## Next Steps

### Week 1: Foundation

- Create PRD (this document) ✓
- Validate with target user (your wife) ✓
- Set up development environment
- Create basic data models
- Implement auth flow

### Week 2: Core Functionality

- Build brain dump interface (text + voice)
- Implement digest generation (AI pipeline)
- Create context modal
- Basic UI/UX polish

### Week 3: Testing & Iteration

- Dogfood with your family (2 weeks)
- Document what works/doesn't
- Iterate based on real usage
- Prep for beta (onboarding flow, etc.)

### Week 4: Beta Launch

- Recruit 5-10 couples
- Onboard with clear expectations
- Weekly check-ins
- Gather qualitative + quantitative data

---

## Key Hypotheses to Test

- **H1:** Primary planners will use voice notes more than text (lower friction)
- **H2:** Less-informed parents will check digest in morning (vs. evening)
- **H3:** AI-generated age-based suggestions will be valued, not seen as intrusive
- **H4:** Conversation starters will feel helpful, not prescriptive
- **H5:** After 4 weeks, users will start anticipating without needing the app as much
