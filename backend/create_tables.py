from sqlalchemy import text
from database import engine, Base
# חשוב לייבא את המודלים כדי שהם יירשמו
from models import User, Document, Thread, Message, Chunk

def init_db():
    print("Connecting to database...")
    
    # 1. הפעלת תוסף הוקטורים אוטומטית
    # אנחנו פותחים חיבור ומריצים פקודת SQL נקייה
    with engine.connect() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.commit()
        print("[INFO] Vector extension enabled!")

    # 2. יצירת הטבלאות
    Base.metadata.create_all(bind=engine)
    print("[INFO] Tables created successfully!")

if __name__ == "__main__":
    init_db()