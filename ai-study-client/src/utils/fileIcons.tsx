import { FileText, FileCode, File, FileImage, FileAudio, Presentation, type LucideIcon } from 'lucide-react';

const CODE_EXTS = new Set([
  '.py', '.js', '.ts', '.tsx', '.jsx',
  '.html', '.css', '.scss',
  '.json', '.yaml', '.yml', '.toml',
  '.cpp', '.c', '.h', '.hpp',
  '.java', '.kt', '.go', '.rs',
  '.sh', '.sql', '.md',
]);
const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.wav', '.webm', '.ogg', '.aac', '.flac']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

export interface FileIconConfig {
  Icon: LucideIcon;
  colorClass: string;
}

export function getFileIconConfig(filename: string): FileIconConfig {
  const dot = filename.lastIndexOf('.');
  const ext = dot !== -1 ? filename.substring(dot).toLowerCase() : '';
  if (ext === '.pdf')                    return { Icon: FileText,     colorClass: 'text-rose-500'   };
  if (ext === '.docx' || ext === '.doc') return { Icon: FileText,     colorClass: 'text-blue-500'   };
  if (ext === '.pptx' || ext === '.ppt') return { Icon: Presentation, colorClass: 'text-orange-500' };
  if (CODE_EXTS.has(ext))               return { Icon: FileCode,      colorClass: 'text-amber-500'  };
  if (AUDIO_EXTS.has(ext))              return { Icon: FileAudio,     colorClass: 'text-purple-500' };
  if (IMAGE_EXTS.has(ext))              return { Icon: FileImage,     colorClass: 'text-emerald-500'};
  return { Icon: File, colorClass: 'text-slate-400' };
}

/** Accepted extensions for the file upload input. Includes audio + image
 *  (added in F-031 for Lecture recordings + handwritten notes). */
export const ACCEPTED_FILE_TYPES =
  '.pdf,.docx,.pptx,.py,.js,.ts,.tsx,.jsx,.html,.css,.scss,.json,.yaml,.yml,.toml,.cpp,.c,.h,.hpp,.java,.kt,.go,.rs,.sh,.sql,.mp3,.m4a,.wav,.webm,.ogg,.aac,.flac,.jpg,.jpeg,.png,.webp,.heic';

/** Accept attribute for lecture-recording uploads only. */
export const LECTURE_RECORDING_TYPES = '.mp3,.m4a,.wav,.webm,.ogg,.aac,.flac';

/** Accept attribute for lecture-notes uploads (PDF or image of handwritten). */
export const LECTURE_NOTES_TYPES = '.pdf,.jpg,.jpeg,.png,.webp,.heic';

interface FileIconProps {
  filename: string;
  /** Size + extra classes. Color is applied automatically from the config. */
  className?: string;
}

export function FileIcon({ filename, className }: FileIconProps) {
  const { Icon, colorClass } = getFileIconConfig(filename);
  return <Icon className={`${colorClass}${className ? ` ${className}` : ''}`} />;
}
