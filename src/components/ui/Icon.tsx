// Icons (UI-AUDIT §3.3 Icon): every icon the operator UI uses, from Phosphor, with the
// house sizes and weights baked in. Server-safe (the Phosphor SSR build: no context), so the
// same imports work in server and client components; each icon is a deep import and a pure
// call, so production bundles keep only the icons a page uses.
//
//   <PlayIcon />                 16 px; weight from size: <= 17 bold, >= 20 regular
//   <PlayIcon size={20} />       20 px regular (Play, Pause, Record default to fill)
//   <TrashIcon weight="fill" />  selected / active state
//   <InfoIcon aria-label="說明" /> labelled icons are exposed; unlabelled ones are aria-hidden
//
// Sizes follow the text: 11-12 px text -> 14, 13 px -> 16, 15-17 px -> 20, top bars and toolbars
// 20, empty states 44. Icon-to-text gap 6 px (gap-1.5). Direct imports of @phosphor-icons/react
// should go through IconProvider (src/components/ui/IconProvider.tsx) instead.
// Generated (see ./kit-icons for the ones the kit itself renders).

import { PlayIcon as PhPlay } from "@phosphor-icons/react/dist/ssr/Play";
import { PauseIcon as PhPause } from "@phosphor-icons/react/dist/ssr/Pause";
import { SkipBackIcon as PhSkipBack } from "@phosphor-icons/react/dist/ssr/SkipBack";
import { SkipForwardIcon as PhSkipForward } from "@phosphor-icons/react/dist/ssr/SkipForward";
import { RewindIcon as PhRewind } from "@phosphor-icons/react/dist/ssr/Rewind";
import { FastForwardIcon as PhFastForward } from "@phosphor-icons/react/dist/ssr/FastForward";
import { RecordIcon as PhRecord } from "@phosphor-icons/react/dist/ssr/Record";
import { CaretDownIcon as PhCaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretUpIcon as PhCaretUp } from "@phosphor-icons/react/dist/ssr/CaretUp";
import { ArrowLeftIcon as PhArrowLeft } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { ArrowRightIcon as PhArrowRight } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { ArrowSquareOutIcon as PhArrowSquareOut } from "@phosphor-icons/react/dist/ssr/ArrowSquareOut";
import { ArrowClockwiseIcon as PhArrowClockwise } from "@phosphor-icons/react/dist/ssr/ArrowClockwise";
import { ArrowCounterClockwiseIcon as PhArrowCounterClockwise } from "@phosphor-icons/react/dist/ssr/ArrowCounterClockwise";
import { ArrowUUpLeftIcon as PhArrowUUpLeft } from "@phosphor-icons/react/dist/ssr/ArrowUUpLeft";
import { ArrowUUpRightIcon as PhArrowUUpRight } from "@phosphor-icons/react/dist/ssr/ArrowUUpRight";
import { ArrowsMergeIcon as PhArrowsMerge } from "@phosphor-icons/react/dist/ssr/ArrowsMerge";
import { ArrowsLeftRightIcon as PhArrowsLeftRight } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { HouseIcon as PhHouse } from "@phosphor-icons/react/dist/ssr/House";
import { BooksIcon as PhBooks } from "@phosphor-icons/react/dist/ssr/Books";
import { XCircleIcon as PhXCircle } from "@phosphor-icons/react/dist/ssr/XCircle";
import { QuestionIcon as PhQuestion } from "@phosphor-icons/react/dist/ssr/Question";
import { CircleIcon as PhCircle } from "@phosphor-icons/react/dist/ssr/Circle";
import { CircleDashedIcon as PhCircleDashed } from "@phosphor-icons/react/dist/ssr/CircleDashed";
import { MusicNotesIcon as PhMusicNotes } from "@phosphor-icons/react/dist/ssr/MusicNotes";
import { MusicNotesPlusIcon as PhMusicNotesPlus } from "@phosphor-icons/react/dist/ssr/MusicNotesPlus";
import { WaveformIcon as PhWaveform } from "@phosphor-icons/react/dist/ssr/Waveform";
import { MicrophoneIcon as PhMicrophone } from "@phosphor-icons/react/dist/ssr/Microphone";
import { MicrophoneSlashIcon as PhMicrophoneSlash } from "@phosphor-icons/react/dist/ssr/MicrophoneSlash";
import { SpeakerHighIcon as PhSpeakerHigh } from "@phosphor-icons/react/dist/ssr/SpeakerHigh";
import { SpeakerSlashIcon as PhSpeakerSlash } from "@phosphor-icons/react/dist/ssr/SpeakerSlash";
import { MetronomeIcon as PhMetronome } from "@phosphor-icons/react/dist/ssr/Metronome";
import { TimerIcon as PhTimer } from "@phosphor-icons/react/dist/ssr/Timer";
import { ClockIcon as PhClock } from "@phosphor-icons/react/dist/ssr/Clock";
import { HandTapIcon as PhHandTap } from "@phosphor-icons/react/dist/ssr/HandTap";
import { HandPalmIcon as PhHandPalm } from "@phosphor-icons/react/dist/ssr/HandPalm";
import { ProjectorScreenIcon as PhProjectorScreen } from "@phosphor-icons/react/dist/ssr/ProjectorScreen";
import { MonitorIcon as PhMonitor } from "@phosphor-icons/react/dist/ssr/Monitor";
import { MonitorPlayIcon as PhMonitorPlay } from "@phosphor-icons/react/dist/ssr/MonitorPlay";
import { MoonIcon as PhMoon } from "@phosphor-icons/react/dist/ssr/Moon";
import { SnowflakeIcon as PhSnowflake } from "@phosphor-icons/react/dist/ssr/Snowflake";
import { EyeIcon as PhEye } from "@phosphor-icons/react/dist/ssr/Eye";
import { EyeSlashIcon as PhEyeSlash } from "@phosphor-icons/react/dist/ssr/EyeSlash";
import { SubtitlesIcon as PhSubtitles } from "@phosphor-icons/react/dist/ssr/Subtitles";
import { SubtitlesSlashIcon as PhSubtitlesSlash } from "@phosphor-icons/react/dist/ssr/SubtitlesSlash";
import { SparkleIcon as PhSparkle } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { PaletteIcon as PhPalette } from "@phosphor-icons/react/dist/ssr/Palette";
import { FilmSlateIcon as PhFilmSlate } from "@phosphor-icons/react/dist/ssr/FilmSlate";
import { FilmStripIcon as PhFilmStrip } from "@phosphor-icons/react/dist/ssr/FilmStrip";
import { ImageIcon as PhImage } from "@phosphor-icons/react/dist/ssr/Image";
import { ImagesIcon as PhImages } from "@phosphor-icons/react/dist/ssr/Images";
import { FrameCornersIcon as PhFrameCorners } from "@phosphor-icons/react/dist/ssr/FrameCorners";
import { CrosshairIcon as PhCrosshair } from "@phosphor-icons/react/dist/ssr/Crosshair";
import { TargetIcon as PhTarget } from "@phosphor-icons/react/dist/ssr/Target";
import { CornersOutIcon as PhCornersOut } from "@phosphor-icons/react/dist/ssr/CornersOut";
import { CornersInIcon as PhCornersIn } from "@phosphor-icons/react/dist/ssr/CornersIn";
import { SquareHalfIcon as PhSquareHalf } from "@phosphor-icons/react/dist/ssr/SquareHalf";
import { LightningIcon as PhLightning } from "@phosphor-icons/react/dist/ssr/Lightning";
import { PencilSimpleIcon as PhPencilSimple } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { TrashIcon as PhTrash } from "@phosphor-icons/react/dist/ssr/Trash";
import { ScissorsIcon as PhScissors } from "@phosphor-icons/react/dist/ssr/Scissors";
import { CopyIcon as PhCopy } from "@phosphor-icons/react/dist/ssr/Copy";
import { DotsThreeIcon as PhDotsThree } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { MagnifyingGlassIcon as PhMagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { UploadSimpleIcon as PhUploadSimple } from "@phosphor-icons/react/dist/ssr/UploadSimple";
import { DownloadSimpleIcon as PhDownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { ExportIcon as PhExport } from "@phosphor-icons/react/dist/ssr/Export";
import { FileTextIcon as PhFileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { PrinterIcon as PhPrinter } from "@phosphor-icons/react/dist/ssr/Printer";
import { TextTIcon as PhTextT } from "@phosphor-icons/react/dist/ssr/TextT";
import { TextAaIcon as PhTextAa } from "@phosphor-icons/react/dist/ssr/TextAa";
import { KeyboardIcon as PhKeyboard } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { GearIcon as PhGear } from "@phosphor-icons/react/dist/ssr/Gear";
import { SlidersHorizontalIcon as PhSlidersHorizontal } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { PlugIcon as PhPlug } from "@phosphor-icons/react/dist/ssr/Plug";
import { CircleHalfIcon as PhCircleHalf } from "@phosphor-icons/react/dist/ssr/CircleHalf";
import { SunIcon as PhSun } from "@phosphor-icons/react/dist/ssr/Sun";
import { makeIcon } from "./icon-base";
import { CaretLeftIcon } from "./kit-icons";
import { CaretRightIcon } from "./kit-icons";
import { CaretUpDownIcon } from "./kit-icons";
import { CheckIcon } from "./kit-icons";
import { MinusIcon } from "./kit-icons";
import { PlusIcon } from "./kit-icons";
import { XIcon } from "./kit-icons";
import { UsersThreeIcon as PhUsersThree } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { TicketIcon as PhTicket } from "@phosphor-icons/react/dist/ssr/Ticket";
import { CalendarBlankIcon as PhCalendarBlank } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { DotsSixVerticalIcon as PhDotsSixVertical } from "@phosphor-icons/react/dist/ssr/DotsSixVertical";
import { ArrowUpIcon as PhArrowUp } from "@phosphor-icons/react/dist/ssr/ArrowUp";
import { ArrowDownIcon as PhArrowDown } from "@phosphor-icons/react/dist/ssr/ArrowDown";
import { BookOpenIcon as PhBookOpen } from "@phosphor-icons/react/dist/ssr/BookOpen";
import { MapPinIcon as PhMapPin } from "@phosphor-icons/react/dist/ssr/MapPin";
import { ListNumbersIcon as PhListNumbers } from "@phosphor-icons/react/dist/ssr/ListNumbers";
import { SignInIcon as PhSignIn } from "@phosphor-icons/react/dist/ssr/SignIn";
import { SignOutIcon as PhSignOut } from "@phosphor-icons/react/dist/ssr/SignOut";
import { CoffeeIcon as PhCoffee } from "@phosphor-icons/react/dist/ssr/Coffee";
import { HourglassIcon as PhHourglass } from "@phosphor-icons/react/dist/ssr/Hourglass";
import { RepeatIcon as PhRepeat } from "@phosphor-icons/react/dist/ssr/Repeat";
import { PushPinSimpleIcon as PhPushPinSimple } from "@phosphor-icons/react/dist/ssr/PushPinSimple";
import { LifebuoyIcon as PhLifebuoy } from "@phosphor-icons/react/dist/ssr/Lifebuoy";
import { BroadcastIcon as PhBroadcast } from "@phosphor-icons/react/dist/ssr/Broadcast";
import { ClockCountdownIcon as PhClockCountdown } from "@phosphor-icons/react/dist/ssr/ClockCountdown";
import { ChartLineUpIcon as PhChartLineUp } from "@phosphor-icons/react/dist/ssr/ChartLineUp";
import { FlagIcon as PhFlag } from "@phosphor-icons/react/dist/ssr/Flag";
import { SwatchesIcon as PhSwatches } from "@phosphor-icons/react/dist/ssr/Swatches";
import { ShieldCheckIcon as PhShieldCheck } from "@phosphor-icons/react/dist/ssr/ShieldCheck";
import { ShieldWarningIcon as PhShieldWarning } from "@phosphor-icons/react/dist/ssr/ShieldWarning";
import { GridNineIcon as PhGridNine } from "@phosphor-icons/react/dist/ssr/GridNine";
import { FadersIcon as PhFaders } from "@phosphor-icons/react/dist/ssr/Faders";
import { PianoKeysIcon as PhPianoKeys } from "@phosphor-icons/react/dist/ssr/PianoKeys";
import { PlugsConnectedIcon as PhPlugsConnected } from "@phosphor-icons/react/dist/ssr/PlugsConnected";
import { LinkBreakIcon as PhLinkBreak } from "@phosphor-icons/react/dist/ssr/LinkBreak";
import { LockSimpleIcon as PhLockSimple } from "@phosphor-icons/react/dist/ssr/LockSimple";
import { SpinnerIcon } from "./kit-icons";
import { CheckCircleIcon } from "./kit-icons";
import { WarningCircleIcon } from "./kit-icons";
import { WarningIcon } from "./kit-icons";
import { InfoIcon } from "./kit-icons";

export { iconWeight, type IconProps, type IconWeight, type UiIcon } from "./icon-base";
export { CaretLeftIcon, CaretRightIcon, CaretUpDownIcon, CheckIcon, MinusIcon, PlusIcon, XIcon, SpinnerIcon, CheckCircleIcon, WarningCircleIcon, WarningIcon, InfoIcon };

// transport
export const PlayIcon = /* @__PURE__ */ makeIcon(PhPlay, "PlayIcon", "fill");
export const PauseIcon = /* @__PURE__ */ makeIcon(PhPause, "PauseIcon", "fill");
export const SkipBackIcon = /* @__PURE__ */ makeIcon(PhSkipBack, "SkipBackIcon");
export const SkipForwardIcon = /* @__PURE__ */ makeIcon(PhSkipForward, "SkipForwardIcon");
export const RewindIcon = /* @__PURE__ */ makeIcon(PhRewind, "RewindIcon");
export const FastForwardIcon = /* @__PURE__ */ makeIcon(PhFastForward, "FastForwardIcon");
export const RecordIcon = /* @__PURE__ */ makeIcon(PhRecord, "RecordIcon", "fill");

// navigation
export const CaretDownIcon = /* @__PURE__ */ makeIcon(PhCaretDown, "CaretDownIcon");
export const CaretUpIcon = /* @__PURE__ */ makeIcon(PhCaretUp, "CaretUpIcon");
export const ArrowLeftIcon = /* @__PURE__ */ makeIcon(PhArrowLeft, "ArrowLeftIcon");
export const ArrowRightIcon = /* @__PURE__ */ makeIcon(PhArrowRight, "ArrowRightIcon");
export const ArrowSquareOutIcon = /* @__PURE__ */ makeIcon(PhArrowSquareOut, "ArrowSquareOutIcon");
export const ArrowClockwiseIcon = /* @__PURE__ */ makeIcon(PhArrowClockwise, "ArrowClockwiseIcon");
export const ArrowCounterClockwiseIcon = /* @__PURE__ */ makeIcon(PhArrowCounterClockwise, "ArrowCounterClockwiseIcon");
export const ArrowUUpLeftIcon = /* @__PURE__ */ makeIcon(PhArrowUUpLeft, "ArrowUUpLeftIcon");
export const ArrowUUpRightIcon = /* @__PURE__ */ makeIcon(PhArrowUUpRight, "ArrowUUpRightIcon");
export const ArrowsMergeIcon = /* @__PURE__ */ makeIcon(PhArrowsMerge, "ArrowsMergeIcon");
export const ArrowsLeftRightIcon = /* @__PURE__ */ makeIcon(PhArrowsLeftRight, "ArrowsLeftRightIcon");
export const HouseIcon = /* @__PURE__ */ makeIcon(PhHouse, "HouseIcon");
export const BooksIcon = /* @__PURE__ */ makeIcon(PhBooks, "BooksIcon");

// status
export const XCircleIcon = /* @__PURE__ */ makeIcon(PhXCircle, "XCircleIcon");
export const QuestionIcon = /* @__PURE__ */ makeIcon(PhQuestion, "QuestionIcon");
export const CircleIcon = /* @__PURE__ */ makeIcon(PhCircle, "CircleIcon");
export const CircleDashedIcon = /* @__PURE__ */ makeIcon(PhCircleDashed, "CircleDashedIcon");

// audio
export const MusicNotesIcon = /* @__PURE__ */ makeIcon(PhMusicNotes, "MusicNotesIcon");
export const MusicNotesPlusIcon = /* @__PURE__ */ makeIcon(PhMusicNotesPlus, "MusicNotesPlusIcon");
export const WaveformIcon = /* @__PURE__ */ makeIcon(PhWaveform, "WaveformIcon");
export const MicrophoneIcon = /* @__PURE__ */ makeIcon(PhMicrophone, "MicrophoneIcon");
export const MicrophoneSlashIcon = /* @__PURE__ */ makeIcon(PhMicrophoneSlash, "MicrophoneSlashIcon");
export const SpeakerHighIcon = /* @__PURE__ */ makeIcon(PhSpeakerHigh, "SpeakerHighIcon");
export const SpeakerSlashIcon = /* @__PURE__ */ makeIcon(PhSpeakerSlash, "SpeakerSlashIcon");
export const MetronomeIcon = /* @__PURE__ */ makeIcon(PhMetronome, "MetronomeIcon");
export const TimerIcon = /* @__PURE__ */ makeIcon(PhTimer, "TimerIcon");
export const ClockIcon = /* @__PURE__ */ makeIcon(PhClock, "ClockIcon");
export const HandTapIcon = /* @__PURE__ */ makeIcon(PhHandTap, "HandTapIcon");
export const HandPalmIcon = /* @__PURE__ */ makeIcon(PhHandPalm, "HandPalmIcon");

// stage
export const ProjectorScreenIcon = /* @__PURE__ */ makeIcon(PhProjectorScreen, "ProjectorScreenIcon");
export const MonitorIcon = /* @__PURE__ */ makeIcon(PhMonitor, "MonitorIcon");
export const MonitorPlayIcon = /* @__PURE__ */ makeIcon(PhMonitorPlay, "MonitorPlayIcon");
export const MoonIcon = /* @__PURE__ */ makeIcon(PhMoon, "MoonIcon");
export const SnowflakeIcon = /* @__PURE__ */ makeIcon(PhSnowflake, "SnowflakeIcon");
export const EyeIcon = /* @__PURE__ */ makeIcon(PhEye, "EyeIcon");
export const EyeSlashIcon = /* @__PURE__ */ makeIcon(PhEyeSlash, "EyeSlashIcon");
export const SubtitlesIcon = /* @__PURE__ */ makeIcon(PhSubtitles, "SubtitlesIcon");
export const SubtitlesSlashIcon = /* @__PURE__ */ makeIcon(PhSubtitlesSlash, "SubtitlesSlashIcon");
export const SparkleIcon = /* @__PURE__ */ makeIcon(PhSparkle, "SparkleIcon");
export const PaletteIcon = /* @__PURE__ */ makeIcon(PhPalette, "PaletteIcon");
export const FilmSlateIcon = /* @__PURE__ */ makeIcon(PhFilmSlate, "FilmSlateIcon");
export const FilmStripIcon = /* @__PURE__ */ makeIcon(PhFilmStrip, "FilmStripIcon");
export const ImageIcon = /* @__PURE__ */ makeIcon(PhImage, "ImageIcon");
export const ImagesIcon = /* @__PURE__ */ makeIcon(PhImages, "ImagesIcon");
export const FrameCornersIcon = /* @__PURE__ */ makeIcon(PhFrameCorners, "FrameCornersIcon");
export const CrosshairIcon = /* @__PURE__ */ makeIcon(PhCrosshair, "CrosshairIcon");
export const TargetIcon = /* @__PURE__ */ makeIcon(PhTarget, "TargetIcon");
export const CornersOutIcon = /* @__PURE__ */ makeIcon(PhCornersOut, "CornersOutIcon");
export const CornersInIcon = /* @__PURE__ */ makeIcon(PhCornersIn, "CornersInIcon");
export const SquareHalfIcon = /* @__PURE__ */ makeIcon(PhSquareHalf, "SquareHalfIcon");
export const LightningIcon = /* @__PURE__ */ makeIcon(PhLightning, "LightningIcon");

// editing
export const PencilSimpleIcon = /* @__PURE__ */ makeIcon(PhPencilSimple, "PencilSimpleIcon");
export const TrashIcon = /* @__PURE__ */ makeIcon(PhTrash, "TrashIcon");
export const ScissorsIcon = /* @__PURE__ */ makeIcon(PhScissors, "ScissorsIcon");
export const CopyIcon = /* @__PURE__ */ makeIcon(PhCopy, "CopyIcon");
export const DotsThreeIcon = /* @__PURE__ */ makeIcon(PhDotsThree, "DotsThreeIcon");
export const MagnifyingGlassIcon = /* @__PURE__ */ makeIcon(PhMagnifyingGlass, "MagnifyingGlassIcon");
export const UploadSimpleIcon = /* @__PURE__ */ makeIcon(PhUploadSimple, "UploadSimpleIcon");
export const DownloadSimpleIcon = /* @__PURE__ */ makeIcon(PhDownloadSimple, "DownloadSimpleIcon");
export const ExportIcon = /* @__PURE__ */ makeIcon(PhExport, "ExportIcon");
export const FileTextIcon = /* @__PURE__ */ makeIcon(PhFileText, "FileTextIcon");
export const PrinterIcon = /* @__PURE__ */ makeIcon(PhPrinter, "PrinterIcon");
export const TextTIcon = /* @__PURE__ */ makeIcon(PhTextT, "TextTIcon");
export const TextAaIcon = /* @__PURE__ */ makeIcon(PhTextAa, "TextAaIcon");
export const KeyboardIcon = /* @__PURE__ */ makeIcon(PhKeyboard, "KeyboardIcon");
export const GearIcon = /* @__PURE__ */ makeIcon(PhGear, "GearIcon");
export const SlidersHorizontalIcon = /* @__PURE__ */ makeIcon(PhSlidersHorizontal, "SlidersHorizontalIcon");
export const PlugIcon = /* @__PURE__ */ makeIcon(PhPlug, "PlugIcon");
export const CircleHalfIcon = /* @__PURE__ */ makeIcon(PhCircleHalf, "CircleHalfIcon");
export const SunIcon = /* @__PURE__ */ makeIcon(PhSun, "SunIcon");

// bands and shows
export const UsersThreeIcon = /* @__PURE__ */ makeIcon(PhUsersThree, "UsersThreeIcon");
export const TicketIcon = /* @__PURE__ */ makeIcon(PhTicket, "TicketIcon");
export const CalendarBlankIcon = /* @__PURE__ */ makeIcon(PhCalendarBlank, "CalendarBlankIcon");
export const DotsSixVerticalIcon = /* @__PURE__ */ makeIcon(PhDotsSixVertical, "DotsSixVerticalIcon");
export const ArrowUpIcon = /* @__PURE__ */ makeIcon(PhArrowUp, "ArrowUpIcon");
export const ArrowDownIcon = /* @__PURE__ */ makeIcon(PhArrowDown, "ArrowDownIcon");
export const BookOpenIcon = /* @__PURE__ */ makeIcon(PhBookOpen, "BookOpenIcon");
export const MapPinIcon = /* @__PURE__ */ makeIcon(PhMapPin, "MapPinIcon");
export const ListNumbersIcon = /* @__PURE__ */ makeIcon(PhListNumbers, "ListNumbersIcon");
export const SignInIcon = /* @__PURE__ */ makeIcon(PhSignIn, "SignInIcon");
export const SignOutIcon = /* @__PURE__ */ makeIcon(PhSignOut, "SignOutIcon");
export const CoffeeIcon = /* @__PURE__ */ makeIcon(PhCoffee, "CoffeeIcon");
export const HourglassIcon = /* @__PURE__ */ makeIcon(PhHourglass, "HourglassIcon");
export const ChartLineUpIcon = /* @__PURE__ */ makeIcon(PhChartLineUp, "ChartLineUpIcon");
export const FlagIcon = /* @__PURE__ */ makeIcon(PhFlag, "FlagIcon");
export const SwatchesIcon = /* @__PURE__ */ makeIcon(PhSwatches, "SwatchesIcon");

// live show (演出控制台)
export const RepeatIcon = /* @__PURE__ */ makeIcon(PhRepeat, "RepeatIcon");
export const PushPinSimpleIcon = /* @__PURE__ */ makeIcon(PhPushPinSimple, "PushPinSimpleIcon");
export const LifebuoyIcon = /* @__PURE__ */ makeIcon(PhLifebuoy, "LifebuoyIcon");
export const BroadcastIcon = /* @__PURE__ */ makeIcon(PhBroadcast, "BroadcastIcon");
export const ClockCountdownIcon = /* @__PURE__ */ makeIcon(PhClockCountdown, "ClockCountdownIcon");
export const ShieldCheckIcon = /* @__PURE__ */ makeIcon(PhShieldCheck, "ShieldCheckIcon");
export const ShieldWarningIcon = /* @__PURE__ */ makeIcon(PhShieldWarning, "ShieldWarningIcon");
export const GridNineIcon = /* @__PURE__ */ makeIcon(PhGridNine, "GridNineIcon");

// sync and controllers (同步與控制器)
export const FadersIcon = /* @__PURE__ */ makeIcon(PhFaders, "FadersIcon");
export const PianoKeysIcon = /* @__PURE__ */ makeIcon(PhPianoKeys, "PianoKeysIcon");
export const PlugsConnectedIcon = /* @__PURE__ */ makeIcon(PhPlugsConnected, "PlugsConnectedIcon");
export const LinkBreakIcon = /* @__PURE__ */ makeIcon(PhLinkBreak, "LinkBreakIcon");
export const LockSimpleIcon = /* @__PURE__ */ makeIcon(PhLockSimple, "LockSimpleIcon");

/** Every icon by name, for the /ui-lab gallery. */
export const ALL_ICONS = { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, RewindIcon, FastForwardIcon, RecordIcon, CaretLeftIcon, CaretRightIcon, CaretDownIcon, CaretUpIcon, CaretUpDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowSquareOutIcon, ArrowClockwiseIcon, ArrowCounterClockwiseIcon, ArrowUUpLeftIcon, ArrowUUpRightIcon, ArrowsMergeIcon, ArrowsLeftRightIcon, HouseIcon, BooksIcon, CheckIcon, CheckCircleIcon, WarningCircleIcon, WarningIcon, InfoIcon, XCircleIcon, XIcon, QuestionIcon, CircleIcon, CircleDashedIcon, SpinnerIcon, MusicNotesIcon, MusicNotesPlusIcon, WaveformIcon, MicrophoneIcon, MicrophoneSlashIcon, SpeakerHighIcon, SpeakerSlashIcon, MetronomeIcon, TimerIcon, ClockIcon, HandTapIcon, HandPalmIcon, ProjectorScreenIcon, MonitorIcon, MonitorPlayIcon, MoonIcon, SnowflakeIcon, EyeIcon, EyeSlashIcon, SubtitlesIcon, SubtitlesSlashIcon, SparkleIcon, PaletteIcon, FilmSlateIcon, FilmStripIcon, ImageIcon, ImagesIcon, FrameCornersIcon, CrosshairIcon, TargetIcon, CornersOutIcon, CornersInIcon, SquareHalfIcon, LightningIcon, PencilSimpleIcon, TrashIcon, ScissorsIcon, CopyIcon, PlusIcon, MinusIcon, DotsThreeIcon, MagnifyingGlassIcon, UploadSimpleIcon, DownloadSimpleIcon, ExportIcon, FileTextIcon, TextTIcon, TextAaIcon, KeyboardIcon, GearIcon, SlidersHorizontalIcon, PlugIcon, CircleHalfIcon, SunIcon, UsersThreeIcon, TicketIcon, CalendarBlankIcon, DotsSixVerticalIcon, ArrowUpIcon, ArrowDownIcon, BookOpenIcon, MapPinIcon, ListNumbersIcon, SignInIcon, SignOutIcon, CoffeeIcon, HourglassIcon, ChartLineUpIcon, FlagIcon, SwatchesIcon, RepeatIcon, PushPinSimpleIcon, LifebuoyIcon, BroadcastIcon, ClockCountdownIcon, ShieldCheckIcon, ShieldWarningIcon, GridNineIcon, PrinterIcon, FadersIcon, PianoKeysIcon, PlugsConnectedIcon, LinkBreakIcon, LockSimpleIcon };
