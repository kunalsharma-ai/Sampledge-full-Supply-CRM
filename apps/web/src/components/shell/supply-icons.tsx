import {
  BadgeCheck, BadgeDollarSign, Bell, Bot, Boxes, Briefcase, Calculator, CalendarClock, CalendarHeart, ChartColumnBig, CircleDot, FileStack,
  FolderKanban, Gauge, Gift, Globe2, HeartPulse, History, KeyRound, LayoutGrid, LifeBuoy, ListChecks, Mail, Map as MapIcon, Milestone,
  Newspaper, Orbit, Palette, Plug, Rocket, Route, Send, Settings2, Shapes, ShieldAlert, Sparkles, Stethoscope, Table2, Target, UserRound,
  Users, Wallet, Wand2, Waypoints, Workflow, Zap, type LucideIcon,
} from 'lucide-react';

/** Icons used by the SUPPLY360 navigation registry (lib/supply/screens.ts), by name. */
export const supplyIcons: Record<string, LucideIcon> = {
  BadgeCheck, BadgeDollarSign, Bell, Bot, Boxes, Briefcase, Calculator, CalendarClock, CalendarHeart, ChartColumnBig, CircleDot, FileStack,
  FolderKanban, Gauge, Gift, Globe2, HeartPulse, History, KeyRound, LayoutGrid, LifeBuoy, ListChecks, Mail, Map: MapIcon, Milestone,
  Newspaper, Orbit, Palette, Plug, Rocket, Route, Send, Settings2, Shapes, ShieldAlert, Sparkles, Stethoscope, Table2, Target, UserRound,
  Users, Wallet, Wand2, Waypoints, Workflow, Zap,
};
export const supplyIcon = (name: string): LucideIcon => supplyIcons[name] ?? CircleDot;
