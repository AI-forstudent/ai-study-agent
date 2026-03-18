import React from 'react';
import { Upload, Loader2, AlertCircle } from 'lucide-react';

// הגדרת ה-Props שהקומפוננטה צריכה לקבל מאבא (App.tsx)
interface FileUploadViewProps {
  isUploading: boolean;
  uploadError: string | null;
  onFileChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  enableGlobalSummary: boolean;                           // <--- הוספנו
  setEnableGlobalSummary: (val: boolean) => void;         // <--- הוספנו
}

const FileUploadView: React.FC<FileUploadViewProps> = ({ 
  isUploading, 
  uploadError, 
  onFileChange,
  enableGlobalSummary,      // תיקון 1: חובה למשוך אותם פה!
  setEnableGlobalSummary    // תיקון 1: חובה למשוך אותם פה!
}) => {
  return (
    <div className="bg-white p-12 rounded-3xl shadow-xl border border-slate-100 text-center max-w-lg w-full">
      <div className={`w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 transition-colors ${
        uploadError ? 'bg-red-50' : 'bg-blue-50'
      }`}>
        {isUploading ? (
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
        ) : uploadError ? (
          <AlertCircle className="w-12 h-12 text-red-500" />
        ) : (
          <Upload className="w-10 h-10 text-blue-600" />
        )}
      </div>

      <h2 className="text-3xl font-bold text-slate-800 mb-3">
        {isUploading ? "מעבד את המסמך..." : "העלה סיכום או מאמר"}
      </h2>
      
      {/* תיקון 2: החזרנו את הכפתור הכחול שמעלה את ה-PDF בפועל! */}
      {!isUploading && (
        <div className="mb-6">
          <label className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold py-4 px-10 rounded-2xl cursor-pointer shadow-lg inline-flex items-center gap-2">
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

      {/* מתג סיכום גלובלי - יושב עכשיו יפה מתחת לכפתור */}
      {!isUploading && (
        <div className="mt-2 flex items-center justify-center gap-3">
          <label className="relative inline-flex items-center cursor-pointer">
            <input 
              type="checkbox" 
              className="sr-only peer" 
              checked={enableGlobalSummary}
              onChange={(e) => setEnableGlobalSummary(e.target.checked)}
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
          <span className="text-sm font-medium text-slate-600">
            ייצר סיכום חכם לכל המסמך (דורש יותר טוקנים 🪙)
          </span>
        </div>
      )}
      
      {uploadError && (
        <p className="mt-4 text-red-500 text-sm font-medium">{uploadError}</p>
      )}
    </div>
  );
};

export default FileUploadView;