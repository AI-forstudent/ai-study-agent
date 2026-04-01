graph TD
    %% מקורות נתונים
    subgraph Data_Sources ["מקורות נתונים (Data Sources)"]
        A[Google Forms<br/>Pre-Usage Survey]
        B[Study Agent App<br/>In-App Feedback]
    end

    %% פייפליינים
    subgraph Pipelines ["צנרת נתונים (Data Pipelines)"]
        C{Apache Airflow<br/>Batch ETL Process}
        D[FastAPI Backend<br/>Real-Time API]
    end

    %% מאגר נתונים
    subgraph Database ["מאגר נתונים מרכזי (PostgreSQL / SQLite)"]
        E[(Table: pre_usage_surveys)]
        F[(Table: in_app_feedback)]
    end

    %% סוכני AI ואנליטיקה
    subgraph AI_Agents ["שכבת ה-AI (Claude Code & Streamlit)"]
        G[Claude Code<br/>Data Analyst Agent]
        H[Streamlit Dashboard<br/>Delta Analysis & Visuals]
        I[Claude Code<br/>PM Agent -> Markdown Backlog]
    end

    %% זרימת הנתונים
    A -->|.csv / API| C
    C -->|Clean & Load| E
    B -->|JSON Payload| D
    D -->|SQLAlchemy Insert| F
    
    E -->|SQL Read| G
    F -->|SQL Read| G
    G -->|Builds & Updates| H
    G -->|Analyzes Data| I