// Universal "Homie" avatar communication layer.
// A state machine of reassuring messages that visually represent what the
// contractor avatar is thinking/doing. Each state has a pool of phrases that
// are shown (and rotated) while that state is active.

export type AvatarState =
  | "IDLE"
  | "UNDERSTANDING_PROJECT"
  | "ANALYZING_PROBLEM"
  | "PLANNING_SOLUTION"
  | "CHECKING_TOOLS"
  | "SAFETY_REVIEW"
  | "GENERATING_STEPS"
  | "READY"
  | "GUIDING_STEP"
  | "WAITING_FOR_USER"
  | "IMAGE_ANALYSIS"
  | "TROUBLESHOOTING"
  | "SIMPLIFYING"
  | "MISTAKE"
  | "COMPLETION";

export const PHRASES: Record<AvatarState, string[]> = {
  IDLE: ["Ready when you are.", "What are we building today?"],
  UNDERSTANDING_PROJECT: [
    "Understanding your project…",
    "Got it — let's tackle this together.",
    "I understand what you need help with.",
    "Looking at your project requirements.",
    "I'm on it.",
    "Let's see what's going on.",
    "Gathering the details.",
    "Understanding your goal.",
  ],
  ANALYZING_PROBLEM: [
    "Identifying what's causing this…",
    "Diagnosing the problem.",
    "Looking at the likely causes.",
    "Narrowing down the source.",
    "Understanding why this happens.",
    "Checking the most common reasons.",
  ],
  PLANNING_SOLUTION: [
    "Building the best approach…",
    "Planning the fix.",
    "Determining the easiest solution.",
    "Choosing the safest method.",
    "Finding the most reliable repair.",
    "Mapping out the plan.",
  ],
  CHECKING_TOOLS: [
    "Checking the tools and materials you'll need…",
    "Determining required tools.",
    "Lining up the materials.",
    "Preparing your checklist.",
    "Organizing supplies.",
    "Making sure nothing gets overlooked.",
  ],
  SAFETY_REVIEW: [
    "Reviewing safety considerations…",
    "Checking for anything important to watch for.",
    "Making sure this can be done safely.",
    "Looking for precautions.",
    "Building a safe work plan.",
    "Checking local codes & conditions.",
  ],
  GENERATING_STEPS: [
    "Creating your instructions…",
    "Preparing your guide.",
    "Organizing the steps.",
    "Putting everything together.",
    "Building your project plan.",
    "Almost there…",
  ],
  READY: [
    "Ready to guide you through this.",
    "We've got this.",
    "Let's get started.",
    "I'll walk you through every step.",
    "Everything is ready.",
    "I'm here with you the whole way.",
  ],
  GUIDING_STEP: [
    "Here's your next move.",
    "Follow along with me.",
    "Take it one step at a time.",
    "I'll keep you on track.",
  ],
  WAITING_FOR_USER: [
    "Take your time.",
    "Let me know when you're ready.",
    "Ready for the next step?",
    "Need a closer explanation?",
    "We can go slower if you'd like.",
  ],
  IMAGE_ANALYSIS: [
    "Examining your photo…",
    "Taking a closer look.",
    "Looking for visible issues.",
    "Comparing what I see.",
    "Gathering visual details.",
    "Analyzing the problem area.",
  ],
  TROUBLESHOOTING: [
    "Re-evaluating the repair…",
    "Let's troubleshoot this together.",
    "Something may have been missed.",
    "Looking for another cause.",
    "Adjusting our approach.",
    "No worries — we'll figure it out.",
  ],
  SIMPLIFYING: [
    "Simplifying the instructions…",
    "Breaking this down further.",
    "Making it easier to follow.",
    "Explaining in more detail.",
    "Here's another way to do it.",
  ],
  MISTAKE: [
    "That's okay — let's correct it.",
    "Easy fix.",
    "No problem at all.",
    "We can recover from that.",
    "Let's get back on track.",
    "Happens all the time.",
  ],
  COMPLETION: [
    "Nice work — your project is complete!",
    "Everything looks finished.",
    "Great job.",
    "That should be working properly now.",
    "Another successful DIY project.",
    "Ready for the next one?",
  ],
};

// The ordered sequence the avatar walks through while a guide is being built.
export const GENERATION_SEQUENCE: AvatarState[] = [
  "UNDERSTANDING_PROJECT",
  "ANALYZING_PROBLEM",
  "PLANNING_SOLUTION",
  "CHECKING_TOOLS",
  "SAFETY_REVIEW",
  "GENERATING_STEPS",
];

export function randomPhrase(state: AvatarState): string {
  const pool = PHRASES[state] || [];
  if (!pool.length) return "";
  return pool[Math.floor(Math.random() * pool.length)];
}
