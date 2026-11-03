/** All UI strings live here so a second language (e.g. `de.ts`) can be added later. */
export const en = {
  app: { name: 'Learning', tagline: 'Your plans, your pace.' },
  nav: { home: 'Home', subjects: 'Subjects', settings: 'Settings', logout: 'Log out', theme: 'Theme', light: 'Light', dark: 'Dark', system: 'System' },
  common: {
    save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', close: 'Close', back: 'Back', create: 'Create',
    loading: 'Loading…', error: 'Something went wrong.', retry: 'Retry', copy: 'Copy', copied: 'Copied!', search: 'Search',
    minutes: 'min', hours: 'h', none: 'None', optional: 'optional', confirmDelete: 'Delete “{name}”? This cannot be undone.',
    saved: 'Saved', unsaved: 'Unsaved changes', open: 'Open', more: 'More', all: 'All', yes: 'Yes', no: 'No',
  },
  login: { title: 'Welcome back', subtitle: 'Enter your password to continue.', password: 'Password', submit: 'Log in', wrong: 'Wrong password.', tooMany: 'Too many attempts. Wait a minute.' },
  status: { not_started: 'Not started', in_progress: 'In progress', understood: 'Understood', mastered: 'Mastered', ready: 'Ready to learn', blocked: 'Blocked by' },
  dashboard: {
    title: 'Today', empty: 'No subjects yet.', emptyHint: 'Create a subject and import your first learning plan.',
    readyToLearn: 'Ready to learn next', nothingReady: 'Nothing is unblocked right now — finish what is in progress.',
    inProgress: 'Continue', upcomingExams: 'Upcoming exams', daysLeft: '{n} days left', examToday: 'Exam today', examPassed: 'past',
    newSubject: 'New subject', importPlan: 'Import plan',
  },
  subject: {
    title: 'Subject', plans: 'Learning plans', exercises: 'Exercises', noPlans: 'No learning plans yet.', noPlansHint: 'Import a JSON plan or paste a Markdown outline. Use the generation prompt to let an AI write one.',
    name: 'Name', color: 'Color', icon: 'Icon', description: 'Description', createTitle: 'New subject', editTitle: 'Edit subject',
    deleteWarning: 'Deleting the subject removes all its plans, exercises and notes.', archived: 'Archived', nodes: '{n} topics', lastImport: 'Imported {date}',
  },
  plan: {
    map: 'Map', outline: 'Outline', schedule: 'Schedule', exam: 'Exam', noExam: 'No exam date', setExam: 'Set exam date', examName: 'Exam name',
    export: 'Export JSON', exportWithProgress: 'With my progress & notes', exportClean: 'Clean (for sharing)', reimport: 'Update from file', delete: 'Delete plan',
    progress: '{done} of {total} done', readyCount: '{n} ready', remaining: '{time} remaining', edit: 'Edit plan', title: 'Title',
    capacity: 'Daily study capacity', focus: 'Focus', showAll: 'Show all', direction: 'Direction', collapseAll: 'Collapse all', expandAll: 'Expand all',
    fit: 'Fit view', legend: 'Legend', hierarchyEdge: 'Hierarchy', requiredEdge: 'Required prerequisite', recommendedEdge: 'Recommended',
    onlyUnfinished: 'Hide finished', noNodes: 'This plan has no topics.',
  },
  node: {
    objectives: 'Learning objectives', resources: 'Resources', prerequisites: 'Prerequisites', unlocks: 'Unlocks', notes: 'Notes', exercises: 'Exercises',
    flashcards: 'Flashcards', estimated: 'Estimated', difficulty: 'Difficulty', keywords: 'Keywords', description: 'Description',
    notesPlaceholder: 'Your notes (Markdown + $LaTeX$)…', preview: 'Preview', write: 'Write', noExercises: 'No exercises linked yet.', children: 'Subtopics',
    childrenDone: '{done}/{total} subtopics done', markAll: 'Mark subtopics', readyHint: 'All prerequisites are done — this is a good next step.',
    blockedHint: 'Finish the required prerequisites first.', editTitle: 'Edit topic', estimatedMinutes: 'Estimated minutes',
  },
  import: {
    title: 'Import learning plan', subtitle: 'Paste JSON in the plan format, or a Markdown outline. We validate before anything is saved.',
    paste: 'Paste JSON or Markdown here…', file: 'Choose file', target: 'Subject', newSubject: 'New subject…', newSubjectName: 'Subject name',
    check: 'Check', import: 'Import', update: 'Update plan', preview: 'Preview', issues: 'Problems', warnings: 'Warnings', valid: 'Looks good.',
    willCreate: 'Creates a new plan “{title}” with {n} topics.', willMerge: 'Updates the existing plan “{title}”.',
    added: 'added', changed: 'changed', unchanged: 'unchanged', removed: 'removed', exercises: '{n} exercises', flashcards: '{n} flashcards',
    removedPolicy: 'Topics missing from the file', archive: 'Keep (archive)', deleteRemoved: 'Delete', hasProgress: 'has progress', hasNote: 'has notes',
    includesProgress: 'The file contains progress — import it too', includesNotes: 'The file contains notes — import them too', overwriteProgress: 'Overwrite my existing progress',
    detected: 'Detected format: {fmt}', mergeHint: 'Progress and notes on existing topics are kept.', generationPrompt: 'Generation prompt',
    done: 'Imported.',
  },
  prompt: {
    title: 'Copy generation prompt', subtitle: 'Paste this into any LLM. It returns a plan in exactly the right format.',
    topic: 'Topic / course', topicPlaceholder: 'e.g. Signals & Systems, Analysis 2, MRI physics', context: 'Context', contextPlaceholder: 'Degree, semester, lecturer notes, what to emphasise…',
    language: 'Content language', examDate: 'Exam date', nodeCount: 'Target size', copy: 'Copy prompt', preview: 'Prompt preview', schema: 'JSON Schema',
  },
  exercise: {
    title: 'Exercise', parts: 'Parts', hint: 'Show hint', hints: 'Hints', solution: 'Show solution', hideSolution: 'Hide solution', logAttempt: 'Log attempt',
    solved: 'Solved', partial: 'Partially', failed: 'Failed', attemptNotes: 'Notes (what went wrong, what to remember)', attempts: 'Attempts', noAttempts: 'No attempts yet.',
    difficulty: 'Difficulty', source: 'Source', linkedTopics: 'Linked topics',
  },
  errors: { notFound: 'Not found.', offline: 'You appear to be offline.' },
} as const

export type Messages = typeof en
