import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AudioLinesIcon,
  Bold,
  Building2,
  CalendarClock,
  Camera,
  Check,
  CircleStop,
  Code,
  Eye,
  FileText,
  FileUp,
  Fingerprint,
  GitBranch,
  Hash,
  Heading,
  Home,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Mic,
  Network,
  Paperclip,
  Pause,
  PenLine,
  Pencil,
  Pin,
  Play,
  Plus,
  Quote,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  SquarePen,
  StickyNote,
  Strikethrough,
  Trash2,
  UserRound,
  X,
} from "@hugeicons/core-free-icons";
import {
  HugeiconsIcon,
  type HugeiconsIconProps,
  type IconSvgElement,
} from "@hugeicons/react";
import * as React from "react";

export type IconProps = Omit<HugeiconsIconProps, "icon">;
export type IconComponent = React.ForwardRefExoticComponent<
  IconProps & React.RefAttributes<SVGSVGElement>
>;

function createIcon(icon: IconSvgElement, displayName: string): IconComponent {
  const Icon = React.forwardRef<SVGSVGElement, IconProps>((props, ref) => (
    <HugeiconsIcon ref={ref} icon={icon} {...props} />
  ));
  Icon.displayName = displayName;
  return Icon;
}

export const ArrowLeftIcon = createIcon(ArrowLeft, "ArrowLeftIcon");
export const ArrowRightIcon = createIcon(ArrowRight, "ArrowRightIcon");
export const ArrowUpRightIcon = createIcon(ArrowUpRight, "ArrowUpRightIcon");
export const AudioLinesIconView = createIcon(AudioLinesIcon, "AudioLinesIcon");
export const BoldIcon = createIcon(Bold, "BoldIcon");
export const BuildingIcon = createIcon(Building2, "BuildingIcon");
export const CalendarClockIcon = createIcon(CalendarClock, "CalendarClockIcon");
export const CameraIcon = createIcon(Camera, "CameraIcon");
export const CheckIcon = createIcon(Check, "CheckIcon");
export const CircleStopIcon = createIcon(CircleStop, "CircleStopIcon");
export const CodeIcon = createIcon(Code, "CodeIcon");
export const EyeIcon = createIcon(Eye, "EyeIcon");
export const FileTextIcon = createIcon(FileText, "FileTextIcon");
export const FileUpIcon = createIcon(FileUp, "FileUpIcon");
export const FingerprintIcon = createIcon(Fingerprint, "FingerprintIcon");
export const GitBranchIcon = createIcon(GitBranch, "GitBranchIcon");
export const HashIcon = createIcon(Hash, "HashIcon");
export const HeadingIcon = createIcon(Heading, "HeadingIcon");
export const HomeIcon = createIcon(Home, "HomeIcon");
export const ImageViewIcon = createIcon(ImageIcon, "ImageViewIcon");
export const ItalicIcon = createIcon(Italic, "ItalicIcon");
export const LinkIcon = createIcon(Link2, "LinkIcon");
export const ListIcon = createIcon(List, "ListIcon");
export const ListOrderedIcon = createIcon(ListOrdered, "ListOrderedIcon");
export const LoaderIcon = createIcon(Loader, "LoaderIcon");
export const LockIcon = createIcon(Lock, "LockIcon");
export const LogOutIcon = createIcon(LogOut, "LogOutIcon");
export const MailIcon = createIcon(Mail, "MailIcon");
export const MapPinIcon = createIcon(MapPin, "MapPinIcon");
export const MenuIcon = createIcon(Menu, "MenuIcon");
export const MicIcon = createIcon(Mic, "MicIcon");
export const NetworkIcon = createIcon(Network, "NetworkIcon");
export const PaperclipIcon = createIcon(Paperclip, "PaperclipIcon");
export const PauseIcon = createIcon(Pause, "PauseIcon");
export const PenLineIcon = createIcon(PenLine, "PenLineIcon");
export const PencilIcon = createIcon(Pencil, "PencilIcon");
export const PinIcon = createIcon(Pin, "PinIcon");
export const PlayIcon = createIcon(Play, "PlayIcon");
export const PlusIcon = createIcon(Plus, "PlusIcon");
export const QuoteIcon = createIcon(Quote, "QuoteIcon");
export const RefreshIcon = createIcon(RefreshCw, "RefreshIcon");
export const RotateIcon = createIcon(RotateCw, "RotateIcon");
export const SearchIcon = createIcon(Search, "SearchIcon");
export const ShieldCheckIcon = createIcon(ShieldCheck, "ShieldCheckIcon");
export const SparklesIcon = createIcon(Sparkles, "SparklesIcon");
export const SquareIcon = createIcon(Square, "SquareIcon");
export const SquarePenIcon = createIcon(SquarePen, "SquarePenIcon");
export const StickyNoteIcon = createIcon(StickyNote, "StickyNoteIcon");
export const StrikethroughIcon = createIcon(Strikethrough, "StrikethroughIcon");
export const TrashIcon = createIcon(Trash2, "TrashIcon");
export const TriangleAlertIcon = createIcon(AlertTriangle, "TriangleAlertIcon");
export const UserIcon = createIcon(UserRound, "UserIcon");
export const CloseIcon = createIcon(X, "CloseIcon");

// Familiar semantic names keep call sites terse while every glyph is rendered
// through HugeiconsIcon and the Hugeicons free icon data.
export {
  ArrowLeftIcon as ArrowLeft,
  ArrowRightIcon as ArrowRight,
  ArrowUpRightIcon as ArrowUpRight,
  AudioLinesIconView as AudioLines,
  BoldIcon as Bold,
  BuildingIcon as Building2,
  CalendarClockIcon as CalendarClock,
  CameraIcon as Camera,
  CheckIcon as Check,
  CircleStopIcon as CircleStop,
  CodeIcon as Code,
  EyeIcon as Eye,
  FileTextIcon as FileText,
  FileUpIcon as FileUp,
  FingerprintIcon as Fingerprint,
  GitBranchIcon as GitBranch,
  HashIcon as Hash,
  HeadingIcon as Heading,
  HomeIcon as Home,
  ImageViewIcon as ImageIcon,
  ItalicIcon as Italic,
  LinkIcon as Link2,
  ListIcon as List,
  ListOrderedIcon as ListOrdered,
  LoaderIcon as Loader,
  LockIcon as Lock,
  LogOutIcon as LogOut,
  MailIcon as Mail,
  MapPinIcon as MapPin,
  MenuIcon as Menu,
  MicIcon as Mic,
  NetworkIcon as Network,
  PaperclipIcon as Paperclip,
  PauseIcon as Pause,
  PenLineIcon as PenLine,
  PencilIcon as Pencil,
  PinIcon as Pin,
  PlayIcon as Play,
  PlusIcon as Plus,
  QuoteIcon as Quote,
  RefreshIcon as RefreshCw,
  RotateIcon as RotateCw,
  SearchIcon as Search,
  ShieldCheckIcon as ShieldCheck,
  SparklesIcon as Sparkles,
  SquareIcon as Square,
  SquarePenIcon as SquarePen,
  StickyNoteIcon as StickyNote,
  StrikethroughIcon as Strikethrough,
  TrashIcon as Trash2,
  TriangleAlertIcon as TriangleAlert,
  UserIcon as UserRound,
  CloseIcon as X,
};
