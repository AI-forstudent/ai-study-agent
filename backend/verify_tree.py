# verify_tree.py

import sys
from sqlalchemy.orm import Session
from database import SessionLocal
import models
import services

def print_tree(db: Session):
    threads = db.query(models.Thread).all()
    if not threads:
        print("No threads found in the database. Go to the UI and create some!")
        return

    # בניית מילון ילדים (Adjacency List) לסריקה מהירה של העץ
    children_map = {}
    for t in threads:
        children_map.setdefault(t.parent_thread_id, []).append(t)

    def traverse(thread_id, depth=0):
        # שליפת השרשור הנוכחי
        thread = db.query(models.Thread).filter(models.Thread.id == thread_id).first()
        indent = "    " * depth
        
        # 1. בדיקת הודעות פיזיות (מה שבאמת יושב ב-DB תחת ה-ID הזה)
        physical_msgs = db.query(models.Message).filter(models.Message.thread_id == thread.id).order_by(models.Message.id).all()
        
        # 2. בדיקת ההיסטוריה הווירטואלית (המנגנון ההיברידי שלנו!)
        try:
            virtual_history = services.get_full_thread_history(thread.id, db)
            history_status = "✅ OK"
        except Exception as e:
            virtual_history = []
            history_status = f"❌ ERROR: {e}"
        
        # הדפסה ויזואלית של הצומת
        fork_info = f" [Forked from Msg: {thread.forked_from_message_id}]" if thread.parent_thread_id else " [ROOT]"
        print(f"{indent}🌲 Thread ID: {thread.id}{fork_info}")
        print(f"{indent}   ├─ Physical Messages: {len(physical_msgs)}")
        print(f"{indent}   ├─ Virtual History:   {len(virtual_history)} messages {history_status}")
        
        # הדפסת זרימת ההודעות (מזהים של ההודעות) לווידוא סדר כרונולוגי
        if virtual_history:
            msg_ids = [f"Msg_{m.id}" for m in virtual_history]
            print(f"{indent}   └─ Flow: {' -> '.join(msg_ids)}")
        else:
            print(f"{indent}   └─ Flow: Empty")

        print("") # שורת רווח לאסתטיקה

        # קריאה רקורסיבית לילדים (הענפים שפוצלו מפה)
        for child in children_map.get(thread.id, []):
            traverse(child.id, depth + 1)

    print("\n" + "="*50)
    print(" 🌳 AI Study Agent: Thread Tree Verification 🌳")
    print("="*50 + "\n")
    
    # מתחילים את הסריקה משיחות השורש בלבד (parent_thread_id is None)
    roots = children_map.get(None, [])
    for root in roots:
        traverse(root.id)
        print("-" * 50)

if __name__ == "__main__":
    db = SessionLocal()
    try:
        print_tree(db)
    finally:
        db.close()