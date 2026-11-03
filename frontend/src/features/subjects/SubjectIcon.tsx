import {
  Activity,
  Atom,
  BookOpen,
  Brain,
  Calculator,
  Code2,
  Cpu,
  Dna,
  FlaskConical,
  HeartPulse,
  Microscope,
  Radio,
  ScanLine,
  Sigma,
  Waves,
  Zap,
  type LucideProps,
} from 'lucide-react'

const ICONS = {
  'book-open': BookOpen,
  sigma: Sigma,
  calculator: Calculator,
  waves: Waves,
  zap: Zap,
  cpu: Cpu,
  radio: Radio,
  'scan-line': ScanLine,
  'heart-pulse': HeartPulse,
  activity: Activity,
  brain: Brain,
  dna: Dna,
  atom: Atom,
  'flask-conical': FlaskConical,
  microscope: Microscope,
  code: Code2,
} as const

export type SubjectIconName = keyof typeof ICONS
export const SUBJECT_ICONS = Object.keys(ICONS) as SubjectIconName[]

export function SubjectIcon({ name, ...props }: { name: string } & LucideProps) {
  const Icon = (ICONS as Record<string, React.ComponentType<LucideProps>>)[name] ?? BookOpen
  return <Icon {...props} />
}
