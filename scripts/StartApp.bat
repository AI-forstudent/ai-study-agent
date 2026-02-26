@echo off
title AI Study Partner
echo Starting your AI Study Partner...
:: הפקודה הבאה מוודאת שאנחנו רצים מהתיקייה הנכונה
cd /d "%~dp0"
:: הרצת הסקריפט שלנו
python run_system.py
:: אם יש קריסה, החלון לא ייסגר מיד כדי שתוכל לראות מה קרה
pause