import os
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt  # אנחנו עובדים ישירות מול מנוע ההצפנה עכשיו!

# מפתח סודי לייצור ה-JWT (בענן זה יגיע מ-.env)
SECRET_KEY = os.getenv("SECRET_KEY", "my-super-secret-local-key-change-me")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # הטוקן יהיה תקף לשבוע

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """בודק אם הסיסמה שהמשתמש הקליד תואמת להצפנה בדאטאבייס"""
    # bcrypt דורש לעבוד עם ביטים (bytes) ולא עם מחרוזות רגילות
    password_bytes = plain_password.encode('utf-8')
    hash_bytes = hashed_password.encode('utf-8')
    return bcrypt.checkpw(password_bytes, hash_bytes)

def get_password_hash(password: str) -> str:
    """מצפין סיסמה חדשה לפני שמירה בדאטאבייס"""
    password_bytes = password.encode('utf-8')
    # מייצרים "מלח" (Salt) אקראי כדי ששתי סיסמאות זהות לא ייראו אותו דבר בדאטאבייס
    salt = bcrypt.gensalt()
    hashed_bytes = bcrypt.hashpw(password_bytes, salt)
    # ממירים בחזרה למחרוזת כדי ש-SQLAlchemy תוכל לשמור את זה
    return hashed_bytes.decode('utf-8')

def create_access_token(data: dict):
    """מייצר את 'תעודת הזהות הווירטואלית' (JWT Token)"""
    to_encode = data.copy()
    
    # התיקון שהצעת! משתמשים באובייקט מודע לאזור זמן במקום utcnow המיושן
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    
    # חותמים על הטוקן בעזרת המפתח הסודי
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt