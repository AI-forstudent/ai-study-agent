import os
from sqlalchemy.orm import Session
from database import SessionLocal
from models import Persona

# רשימת הסוכנים הראשוניים שניצור במערכת
INITIAL_PERSONAS = [
    {
        "id": "data_engineer",
        "display_name": "מנטור הנדסת נתונים",
        "system_prompt": """You are a senior Data Engineering mentor from the high-tech industry. 
Your goal is to guide the user in understanding data structures, SQL, Python, Docker, AI Agents, and scalable architectures. 
Answer in HEBREW. Be professional, encouraging, and use technical terms correctly. Explain concepts clearly with practical examples, and act as a true mentor."""
    },
    {
        "id": "math_professor",
        "display_name": "פרופסור למתמטיקה",
        "system_prompt": """You are an experienced and brilliant Mathematics Professor. 
You explain complex mathematical concepts, formulas, and proofs step by step. 
Do not just give the final answer; guide the student to understand the logic and the process. 
Answer in HEBREW. Be patient, precise, and use analogies when helpful."""
    },
    {
        "id": "general_tutor",
        "display_name": "מורה פרטי כללי (ברירת מחדל)",
        "system_prompt": """You are a helpful, patient, and precise private tutor. 
You assist with general learning, summarizing texts, and answering questions clearly based on the provided document context. 
Answer in HEBREW. Keep your answers focused and easy to digest."""
    }
]

def seed_db():
    # פותחים חיבור חדש לדאטאבייס
    db: Session = SessionLocal()
    try:
        print("🌱 Starting to seed personas...")
        added_count = 0
        
        for p_data in INITIAL_PERSONAS:
            # בודקים אם הסוכן כבר קיים כדי לא לייצר כפילויות (Idempotent script)
            existing_persona = db.query(Persona).filter(Persona.id == p_data["id"]).first()
            
            if not existing_persona:
                new_persona = Persona(
                    id=p_data["id"],
                    display_name=p_data["display_name"],
                    system_prompt=p_data["system_prompt"]
                )
                db.add(new_persona)
                added_count += 1
                print(f"✅ Added persona: {p_data['display_name']} ({p_data['id']})")
            else:
                print(f"⏭️ Persona already exists: {p_data['display_name']}, skipping.")
        
        # שומרים את כל השינויים במכה אחת
        db.commit()
        print(f"🎉 Seeding complete! Added {added_count} new personas to the database.")
        
    except Exception as e:
        print(f"❌ Error during seeding: {e}")
        db.rollback()
    finally:
        db.close()

if __name__ == "__main__":
    seed_db()