import subprocess
import time
import os
import sys
import webbrowser

# --- הגדרות ---
FRONTEND_DIR = "frontend"

def run_system():
    # הגדרת דגל להסתרת חלונות (עבור הראשים שרצים ברקע)
    startupinfo = None
    creation_flags = 0
    if os.name == 'nt':
        creation_flags = subprocess.CREATE_NO_WINDOW
        
    print("🚀 Starting AI Study Partner (Watchdog Mode)...")

    # 1. הרצת השרת (Backend)
    backend_process = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--reload", "--host", "0.0.0.0", "--port", "8000"],
        cwd=os.getcwd(),
        creationflags=creation_flags
    )

    # 2. הרצת האתר (Frontend)
    npm_cmd = "npm.cmd" if os.name == 'nt' else "npm"
    frontend_process = subprocess.Popen(
        [npm_cmd, "run", "dev"],
        cwd=os.path.join(os.getcwd(), FRONTEND_DIR),
        creationflags=creation_flags
    )

    # 3. פתיחת דפדפן
    print("⏳ Waiting for services...")
    time.sleep(3)
    webbrowser.open("http://localhost:5173")

    print("\n✅ System is running correctly.")
    print("👁️ WATCHDOG ACTIVE: Monitoring backend health...")

    try:
        # --- לולאת השמירה (The Watchdog Loop) ---
        while True:
            # בדיקה: האם השרת (Backend) עדיין רץ?
            # poll() מחזיר None אם התהליך חי, וקוד יציאה אם הוא מת
            if backend_process.poll() is not None:
                print("⚠️ Backend died! Cleaning up frontend...")
                break # יוצאים מהלולאה כדי לסגור הכל
            
            # בדיקה: האם האתר (Frontend) קרס?
            if frontend_process.poll() is not None:
                print("⚠️ Frontend died! Shutting down...")
                break

            time.sleep(1) # בדיקה כל שנייה
            
    except KeyboardInterrupt:
        print("\n🛑 Manual stop detected.")

    # --- ניקוי סופי (Final Cleanup) ---
    print("🧹 Cleaning up remaining processes...")
    
    # וידוא הריגה לשרת
    if backend_process.poll() is None:
        backend_process.terminate()
        
    # וידוא הריגה ל-Node
    if frontend_process.poll() is None:
        # Node לפעמים עקשן בווינדוס, צריך Taskkill כדי לוודא שגם תהליכי הבן מתים
        if os.name == 'nt':
            subprocess.call(['taskkill', '/F', '/T', '/PID', str(frontend_process.pid)], creationflags=creation_flags)
        else:
            frontend_process.terminate()

    print("👋 System closed successfully.")

if __name__ == "__main__":
    if not os.path.exists(FRONTEND_DIR):
         # הודעת שגיאה ויזואלית למקרה שהתיקייה לא קיימת
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, f"Error: '{FRONTEND_DIR}' not found", "Boot Error", 0x10)
    else:
        run_system()