import React from 'react';
import { Upload, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

interface FileUploadViewProps {
  isUploading: boolean;
  uploadError: string | null;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  enableGlobalSummary: boolean;
  setEnableGlobalSummary: (val: boolean) => void;
}

const FileUploadView: React.FC<FileUploadViewProps> = ({
  isUploading,
  uploadError,
  onFileChange,
  enableGlobalSummary,
  setEnableGlobalSummary
}) => {
  return (
    <div className="bg-white p-12 rounded-2xl border border-[#E8E8E6] text-center max-w-lg w-full">
      <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 transition-colors ${
        uploadError === 'DOCUMENT_EXISTS' ? 'bg-sky-50'
          : uploadError ? 'bg-red-50'
          : 'bg-indigo-50'
      }`}>
        {isUploading ? (
          <Loader2 className="w-12 h-12 text-indigo-600 animate-spin" />
        ) : uploadError === 'DOCUMENT_EXISTS' ? (
          <CheckCircle2 className="w-12 h-12 text-sky-500" />
        ) : uploadError ? (
          <AlertCircle className="w-12 h-12 text-red-500" />
        ) : (
          <Upload className="w-10 h-10 text-indigo-600" />
        )}
      </div>

      <h2 className="text-2xl font-semibold text-[#37352F] mb-3">
        {isUploading ? "מעבד את המסמך..." : "העלה סיכום או מאמר"}
      </h2>

      {!isUploading && (
        <div className="mb-6">
          <label className="bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white font-semibold py-3.5 px-8 rounded-xl cursor-pointer shadow-md shadow-indigo-100 inline-flex items-center gap-2 transition-all duration-150">
            <Upload className="w-5 h-5" />
            <span>בחר קובץ PDF</span>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={onFileChange}
            />
          </label>
        </div>
      )}

      {!isUploading && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={enableGlobalSummary}
              onChange={(e) => setEnableGlobalSummary(e.target.checked)}
            />
            <div className="w-11 h-6 bg-[#E8E8E6] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#E8E8E6] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
          </label>
          <span className="text-sm font-medium text-[#787774]">
            ייצר סיכום חכם לכל המסמך (דורש יותר טוקנים 🪙)
          </span>
        </div>
      )}

      {uploadError === 'DOCUMENT_EXISTS' && (
        <div className="mt-4 flex items-start gap-2 p-3 bg-sky-50 border border-sky-200 rounded-lg text-sm text-sky-800 text-start">
          <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0 mt-0.5" />
          <span>This document is already in your library — no need to upload it again!</span>
        </div>
      )}
      {uploadError && uploadError !== 'DOCUMENT_EXISTS' && (
        <p className="mt-4 text-red-500 text-sm font-medium">הייתה בעיה בהעלאת הקובץ לשרת.</p>
      )}
    </div>
  );
};

export default FileUploadView;
