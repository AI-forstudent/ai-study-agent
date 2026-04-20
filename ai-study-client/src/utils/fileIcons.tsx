import { FileText, FileCode, File, Presentation, type LucideIcon } from 'lucide-react';

const CODE_EXTS = new Set([
  '.py', '.js', '.ts', '.tsx', '.jsx',
  '.html', '.css', '.scss',
  '.json', '.yaml', '.yml', '.toml',
  '.cpp', '.c', '.h', '.hpp',
  '.java', '.kt', '.go', '.rs',
  '.sh', '.sql', '.md',
]);

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
  return { Icon: File, colorClass: 'text-slate-400' };
}

/** Accepted extensions for the file upload input. */
export const ACCEPTED_FILE_TYPES =
  '.pdf,.docx,.pptx,.py,.js,.ts,.tsx,.jsx,.html,.css,.scss,.json,.yaml,.yml,.toml,.cpp,.c,.h,.hpp,.java,.kt,.go,.rs,.sh,.sql';

interface FileIconProps {
  filename: string;
  /** Size + extra classes. Color is applied automatically from the config. */
  className?: string;
}

export function FileIcon({ filename, className }: FileIconProps) {
  const { Icon, colorClass } = getFileIconConfig(filename);
  return <Icon className={`${colorClass}${className ? ` ${className}` : ''}`} />;
}
