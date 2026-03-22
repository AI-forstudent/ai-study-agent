import React, { useState } from 'react';
import { Mail, Lock, LogIn, UserPlus, Sparkles, Loader2, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

interface AuthViewProps {
  onLoginSuccess: () => void;
}

const AuthView: React.FC<AuthViewProps> = ({ onLoginSuccess }) => {
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (isLoginMode) {
        // התחברות
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);
        
        const res = await api.login(formData);
        localStorage.setItem('access_token', res.data.access_token);
        onLoginSuccess();
      } else {
        // הרשמה
        await api.register({ email, password });
        
        // מיד אחרי הרשמה מוצלחת, נבצע התחברות אוטומטית
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);
        
        const res = await api.login(formData);
        localStorage.setItem('access_token', res.data.access_token);
        onLoginSuccess();
      }
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "אירעה שגיאה. אנא נסה שוב.");
    } finally {
      setIsLoading(false);
    }
  };

  // =====================================================================
  // 🚀 TODO: REMOVE IN PRODUCTION - מחיקת בלוק נסיינים (אזור לתיק עבודות)
  // =====================================================================
  const handleGuestLogin = async () => {
    setIsLoading(true);
    setError(null);
    
    // פרטי המשתמש הנסייני הקבועים
    const guestEmail = 'demo2@studyagent.ai';
    const guestPassword = 'demo-password-123';

    try {
      // ניסיון 1: מנסים להתחבר כרגיל למשתמש הנסייני
      const formData = new FormData();
      formData.append('username', guestEmail);
      formData.append('password', guestPassword);
      
      const res = await api.login(formData);
      localStorage.setItem('access_token', res.data.access_token);
      onLoginSuccess();
    } catch (err) {
      // ניסיון 2: אם ההתחברות נכשלה (כי המשתמש טרם נוצר בדאטאבייס), ניצור אותו עכשיו אוטומטית!
    try {
        await api.register({ email: guestEmail, password: guestPassword });
        
        // אחרי שהרשמנו אותו בהצלחה, מתחברים אליו
        const formData = new FormData();
        formData.append('username', guestEmail);
        formData.append('password', guestPassword);
        
        const res = await api.login(formData);
        localStorage.setItem('access_token', res.data.access_token);
        onLoginSuccess();
      } catch (registerErr: any) {
        // התיקון: אנחנו שולפים את השגיאה האמיתית מהשרת ומציגים אותה למסך!
        console.error("Full Error:", registerErr);
        const serverError = registerErr.response?.data?.detail || registerErr.message;
        setError(`השרת דחה את הבקשה. סיבה מפורטת: ${serverError}`);
      }
    } finally {
      setIsLoading(false);
    }
  };
  // =====================================================================
  // סוף בלוק מחיקה לפרודקשן
  // =====================================================================

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-4" dir="rtl">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-slate-100 p-8">
        
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl mx-auto flex items-center justify-center mb-4 shadow-lg shadow-blue-200">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">
            {isLoginMode ? 'ברוך שובך!' : 'צור משתמש חדש'}
          </h1>
          <p className="text-slate-500 mt-2">
            AI Study Partner - עוזר הלמידה החכם שלך
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">אימייל</label>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Mail className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full pl-3 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-700"
                placeholder="you@example.com"
                dir="ltr"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">סיסמה</label>
            <div className="relative">
              <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <Lock className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-3 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all text-slate-700"
                placeholder="••••••••"
                dir="ltr"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 disabled:opacity-70"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : (isLoginMode ? <LogIn className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />)}
            {isLoginMode ? 'היכנס למערכת' : 'הרשם עכשיו'}
          </button>
        </form>

        {/* ===================================================================== */}
        {/* 🚀 TODO: REMOVE IN PRODUCTION - מחיקת הכפתור של הנסיינים           */}
        {/* ===================================================================== */}
        <div className="mt-8 pt-6 border-t border-slate-100">
          <button
            onClick={handleGuestLogin}
            disabled={isLoading}
            className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            <Sparkles className="w-5 h-5 text-amber-500" />
            התנסה כאורח (ללא הרשמה)
          </button>
        </div>
        {/* ===================================================================== */}
        {/* סוף אזור מחיקה של הכפתור                                           */}
        {/* ===================================================================== */}

        <div className="mt-6 text-center">
          <button
            onClick={() => {
              setIsLoginMode(!isLoginMode);
              setError(null);
            }}
            className="text-sm font-semibold text-blue-600 hover:text-blue-800 transition-colors"
          >
            {isLoginMode ? 'אין לך משתמש? לחץ כאן להרשמה' : 'כבר יש לך חשבון? לחץ כאן להתחברות'}
          </button>
        </div>

      </div>
    </div>
  );
};

export default AuthView;