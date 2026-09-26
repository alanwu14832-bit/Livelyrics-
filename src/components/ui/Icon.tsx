// Icons (UI-AUDIT §3.3 Icon): every icon the operator UI uses, from Phosphor, with the
// house sizes and weights baked in. Server-safe (the Phosphor SSR build: no context), so the
// same imports work in server and client components; each icon is a deep import, so only the
// icons listed here are compiled.
//
//   <PlayIcon />                 16 px; weight from size: <= 16 bold, >= 20 regular
//   <PlayIcon size={20} />       20 px regular (Play, Pause, Record default to fill)
//   <TrashIcon weight="fill" />  selected / active state
//   <InfoIcon aria-label="說明" /> labelled icons are exposed; unlabelled ones are aria-hidden
//
// Sizes follow the text: 11-12 px text -> 14, 13 px -> 16, 15-17 px -> 20, top bars and toolbars
// 20, empty states 44. Icon-to-text gap 6 px (gap-1.5). Direct imports of @phosphor-icons/react
// should go through IconProvider (src/components/ui/IconProvider.tsx) instead.

import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps, IconWeight } from "@phosphor-icons/react/lib";
import type { ReactElement } from "react";
import { PlayIcon as PhPlay } from "@phosphor-icons/react/dist/ssr/Play";
import { PauseIcon as PhPause } from "@phosphor-icons/react/dist/ssr/Pause";
import { SkipBackIcon as PhSkipBack } from "@phosphor-icons/react/dist/ssr/SkipBack";
import { SkipForwardIcon as PhSkipForward } from "@phosphor-icons/react/dist/ssr/SkipForward";
import { RewindIcon as PhRewind } from "@phosphor-icons/react/dist/ssr/Rewind";
import { FastForwardIcon as PhFastForward } from "@phosphor-icons/react/dist/ssr/FastForward";
import { RecordIcon as PhRecord } from "@phosphor-icons/react/dist/ssr/Record";
import { CaretLeftIcon as PhCaretLeft } from "@phosphor-icons/react/dist/ssr/CaretLeft";
import { CaretRightIcon as PhCaretRight } from "@phosphor-icons/react/dist/ssr/CaretRight";
import { CaretDownIcon as PhCaretDown } from "@phosphor-icons/react/dist/ssr/CaretDown";
import { CaretUpIcon as PhCaretUp } from "@phosphor-icons/react/dist/ssr/CaretUp";
import { CaretUpDownIcon as PhCaretUpDown } from "@phosphor-icons/react/dist/ssr/CaretUpDown";
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
import { CheckIcon as PhCheck } from "@phosphor-icons/react/dist/ssr/Check";
import { CheckCircleIcon as PhCheckCircle } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { WarningCircleIcon as PhWarningCircle } from "@phosphor-icons/react/dist/ssr/WarningCircle";
import { WarningIcon as PhWarning } from "@phosphor-icons/react/dist/ssr/Warning";
import { InfoIcon as PhInfo } from "@phosphor-icons/react/dist/ssr/Info";
import { XCircleIcon as PhXCircle } from "@phosphor-icons/react/dist/ssr/XCircle";
import { XIcon as PhX } from "@phosphor-icons/react/dist/ssr/X";
import { QuestionIcon as PhQuestion } from "@phosphor-icons/react/dist/ssr/Question";
import { CircleIcon as PhCircle } from "@phosphor-icons/react/dist/ssr/Circle";
import { CircleDashedIcon as PhCircleDashed } from "@phosphor-icons/react/dist/ssr/CircleDashed";
import { SpinnerIcon as PhSpinner } from "@phosphor-icons/react/dist/ssr/Spinner";
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
import { PlusIcon as PhPlus } from "@phosphor-icons/react/dist/ssr/Plus";
import { MinusIcon as PhMinus } from "@phosphor-icons/react/dist/ssr/Minus";
import { DotsThreeIcon as PhDotsThree } from "@phosphor-icons/react/dist/ssr/DotsThree";
import { MagnifyingGlassIcon as PhMagnifyingGlass } from "@phosphor-icons/react/dist/ssr/MagnifyingGlass";
import { UploadSimpleIcon as PhUploadSimple } from "@phosphor-icons/react/dist/ssr/UploadSimple";
import { DownloadSimpleIcon as PhDownloadSimple } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { ExportIcon as PhExport } from "@phosphor-icons/react/dist/ssr/Export";
import { FileTextIcon as PhFileText } from "@phosphor-icons/react/dist/ssr/FileText";
import { TextTIcon as PhTextT } from "@phosphor-icons/react/dist/ssr/TextT";
import { TextAaIcon as PhTextAa } from "@phosphor-icons/react/dist/ssr/TextAa";
import { KeyboardIcon as PhKeyboard } from "@phosphor-icons/react/dist/ssr/Keyboard";
import { GearIcon as PhGear } from "@phosphor-icons/react/dist/ssr/Gear";
import { SlidersHorizontalIcon as PhSlidersHorizontal } from "@phosphor-icons/react/dist/ssr/SlidersHorizontal";
import { PlugIcon as PhPlug } from "@phosphor-icons/react/dist/ssr/Plug";
import { CircleHalfIcon as PhCircleHalf } from "@phosphor-icons/react/dist/ssr/CircleHalf";
import { SunIcon as PhSun } from "@phosphor-icons/react/dist/ssr/Sun";

export type { IconWeight };
export type IconProps = Omit<PhosphorIconProps, "size"> & {
  /** px; default 16 */
  size?: number;
};
/** One of the icon components exported below. */
export type UiIcon = ((props: IconProps) => ReactElement) & { displayName?: string };

/** House rule: small icons are bold (about 1.5 px strokes, like small SF Symbols), 20 px and up regular. */
export function iconWeight(size: number): IconWeight {
  return size <= 17 ? "bold" : "regular";
}

function make(Component: PhosphorIcon, displayName: string, fixedWeight?: IconWeight): UiIcon {
  function UiIconComponent({ size = 16, weight, ...rest }: IconProps) {
    const labelled = rest["aria-label"] != null || rest["aria-labelledby"] != null || rest.alt != null;
    return <Component size={size} weight={weight ?? fixedWeight ?? iconWeight(size)} aria-hidden={labelled ? undefined : true} focusable="false" {...rest} />;
  }
  UiIconComponent.displayName = displayName;
  return UiIconComponent;
}

// transport
export const PlayIcon = make(PhPlay, "PlayIcon", "fill");
export const PauseIcon = make(PhPause, "PauseIcon", "fill");
export const SkipBackIcon = make(PhSkipBack, "SkipBackIcon");
export const SkipForwardIcon = make(PhSkipForward, "SkipForwardIcon");
export const RewindIcon = make(PhRewind, "RewindIcon");
export const FastForwardIcon = make(PhFastForward, "FastForwardIcon");
export const RecordIcon = make(PhRecord, "RecordIcon", "fill");

// navigation
export const CaretLeftIcon = make(PhCaretLeft, "CaretLeftIcon");
export const CaretRightIcon = make(PhCaretRight, "CaretRightIcon");
export const CaretDownIcon = make(PhCaretDown, "CaretDownIcon");
export const CaretUpIcon = make(PhCaretUp, "CaretUpIcon");
export const CaretUpDownIcon = make(PhCaretUpDown, "CaretUpDownIcon");
export const ArrowLeftIcon = make(PhArrowLeft, "ArrowLeftIcon");
export const ArrowRightIcon = make(PhArrowRight, "ArrowRightIcon");
export const ArrowSquareOutIcon = make(PhArrowSquareOut, "ArrowSquareOutIcon");
export const ArrowClockwiseIcon = make(PhArrowClockwise, "ArrowClockwiseIcon");
export const ArrowCounterClockwiseIcon = make(PhArrowCounterClockwise, "ArrowCounterClockwiseIcon");
export const ArrowUUpLeftIcon = make(PhArrowUUpLeft, "ArrowUUpLeftIcon");
export const ArrowUUpRightIcon = make(PhArrowUUpRight, "ArrowUUpRightIcon");
export const ArrowsMergeIcon = make(PhArrowsMerge, "ArrowsMergeIcon");
export const ArrowsLeftRightIcon = make(PhArrowsLeftRight, "ArrowsLeftRightIcon");
export const HouseIcon = make(PhHouse, "HouseIcon");
export const BooksIcon = make(PhBooks, "BooksIcon");

// status
export const CheckIcon = make(PhCheck, "CheckIcon");
export const CheckCircleIcon = make(PhCheckCircle, "CheckCircleIcon");
export const WarningCircleIcon = make(PhWarningCircle, "WarningCircleIcon");
export const WarningIcon = make(PhWarning, "WarningIcon");
export const InfoIcon = make(PhInfo, "InfoIcon");
export const XCircleIcon = make(PhXCircle, "XCircleIcon");
export const XIcon = make(PhX, "XIcon");
export const QuestionIcon = make(PhQuestion, "QuestionIcon");
export const CircleIcon = make(PhCircle, "CircleIcon");
export const CircleDashedIcon = make(PhCircleDashed, "CircleDashedIcon");
export const SpinnerIcon = make(PhSpinner, "SpinnerIcon");

// audio
export const MusicNotesIcon = make(PhMusicNotes, "MusicNotesIcon");
export const MusicNotesPlusIcon = make(PhMusicNotesPlus, "MusicNotesPlusIcon");
export const WaveformIcon = make(PhWaveform, "WaveformIcon");
export const MicrophoneIcon = make(PhMicrophone, "MicrophoneIcon");
export const MicrophoneSlashIcon = make(PhMicrophoneSlash, "MicrophoneSlashIcon");
export const SpeakerHighIcon = make(PhSpeakerHigh, "SpeakerHighIcon");
export const SpeakerSlashIcon = make(PhSpeakerSlash, "SpeakerSlashIcon");
export const MetronomeIcon = make(PhMetronome, "MetronomeIcon");
export const TimerIcon = make(PhTimer, "TimerIcon");
export const ClockIcon = make(PhClock, "ClockIcon");
export const HandTapIcon = make(PhHandTap, "HandTapIcon");
export const HandPalmIcon = make(PhHandPalm, "HandPalmIcon");

// stage
export const ProjectorScreenIcon = make(PhProjectorScreen, "ProjectorScreenIcon");
export const MonitorIcon = make(PhMonitor, "MonitorIcon");
export const MonitorPlayIcon = make(PhMonitorPlay, "MonitorPlayIcon");
export const MoonIcon = make(PhMoon, "MoonIcon");
export const SnowflakeIcon = make(PhSnowflake, "SnowflakeIcon");
export const EyeIcon = make(PhEye, "EyeIcon");
export const EyeSlashIcon = make(PhEyeSlash, "EyeSlashIcon");
export const SubtitlesIcon = make(PhSubtitles, "SubtitlesIcon");
export const SubtitlesSlashIcon = make(PhSubtitlesSlash, "SubtitlesSlashIcon");
export const SparkleIcon = make(PhSparkle, "SparkleIcon");
export const PaletteIcon = make(PhPalette, "PaletteIcon");
export const FilmSlateIcon = make(PhFilmSlate, "FilmSlateIcon");
export const CrosshairIcon = make(PhCrosshair, "CrosshairIcon");
export const TargetIcon = make(PhTarget, "TargetIcon");
export const CornersOutIcon = make(PhCornersOut, "CornersOutIcon");
export const CornersInIcon = make(PhCornersIn, "CornersInIcon");
export const SquareHalfIcon = make(PhSquareHalf, "SquareHalfIcon");
export const LightningIcon = make(PhLightning, "LightningIcon");

// editing
export const PencilSimpleIcon = make(PhPencilSimple, "PencilSimpleIcon");
export const TrashIcon = make(PhTrash, "TrashIcon");
export const ScissorsIcon = make(PhScissors, "ScissorsIcon");
export const CopyIcon = make(PhCopy, "CopyIcon");
export const PlusIcon = make(PhPlus, "PlusIcon");
export const MinusIcon = make(PhMinus, "MinusIcon");
export const DotsThreeIcon = make(PhDotsThree, "DotsThreeIcon");
export const MagnifyingGlassIcon = make(PhMagnifyingGlass, "MagnifyingGlassIcon");
export const UploadSimpleIcon = make(PhUploadSimple, "UploadSimpleIcon");
export const DownloadSimpleIcon = make(PhDownloadSimple, "DownloadSimpleIcon");
export const ExportIcon = make(PhExport, "ExportIcon");
export const FileTextIcon = make(PhFileText, "FileTextIcon");
export const TextTIcon = make(PhTextT, "TextTIcon");
export const TextAaIcon = make(PhTextAa, "TextAaIcon");
export const KeyboardIcon = make(PhKeyboard, "KeyboardIcon");
export const GearIcon = make(PhGear, "GearIcon");
export const SlidersHorizontalIcon = make(PhSlidersHorizontal, "SlidersHorizontalIcon");
export const PlugIcon = make(PhPlug, "PlugIcon");
export const CircleHalfIcon = make(PhCircleHalf, "CircleHalfIcon");
export const SunIcon = make(PhSun, "SunIcon");

/** Every icon by name, for the /ui-lab gallery. */
export const ALL_ICONS: Record<string, UiIcon> = { PlayIcon, PauseIcon, SkipBackIcon, SkipForwardIcon, RewindIcon, FastForwardIcon, RecordIcon, CaretLeftIcon, CaretRightIcon, CaretDownIcon, CaretUpIcon, CaretUpDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowSquareOutIcon, ArrowClockwiseIcon, ArrowCounterClockwiseIcon, ArrowUUpLeftIcon, ArrowUUpRightIcon, ArrowsMergeIcon, ArrowsLeftRightIcon, HouseIcon, BooksIcon, CheckIcon, CheckCircleIcon, WarningCircleIcon, WarningIcon, InfoIcon, XCircleIcon, XIcon, QuestionIcon, CircleIcon, CircleDashedIcon, SpinnerIcon, MusicNotesIcon, MusicNotesPlusIcon, WaveformIcon, MicrophoneIcon, MicrophoneSlashIcon, SpeakerHighIcon, SpeakerSlashIcon, MetronomeIcon, TimerIcon, ClockIcon, HandTapIcon, HandPalmIcon, ProjectorScreenIcon, MonitorIcon, MonitorPlayIcon, MoonIcon, SnowflakeIcon, EyeIcon, EyeSlashIcon, SubtitlesIcon, SubtitlesSlashIcon, SparkleIcon, PaletteIcon, FilmSlateIcon, CrosshairIcon, TargetIcon, CornersOutIcon, CornersInIcon, SquareHalfIcon, LightningIcon, PencilSimpleIcon, TrashIcon, ScissorsIcon, CopyIcon, PlusIcon, MinusIcon, DotsThreeIcon, MagnifyingGlassIcon, UploadSimpleIcon, DownloadSimpleIcon, ExportIcon, FileTextIcon, TextTIcon, TextAaIcon, KeyboardIcon, GearIcon, SlidersHorizontalIcon, PlugIcon, CircleHalfIcon, SunIcon };
