from typing import Literal
from pydantic import BaseModel, Field, ConfigDict


class Applicant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    person_age: int = Field(ge=18, le=100)
    person_income: float = Field(gt=0, allow_inf_nan=False)
    person_home_ownership: Literal["RENT", "OWN", "MORTGAGE", "OTHER"]
    person_emp_length: float | None = Field(default=None, ge=0, le=85, allow_inf_nan=False)
    loan_intent: Literal[
        "PERSONAL",
        "EDUCATION",
        "MEDICAL",
        "VENTURE",
        "HOMEIMPROVEMENT",
        "DEBTCONSOLIDATION",
    ]
    loan_amnt: float = Field(gt=0, allow_inf_nan=False)
    cb_person_default_on_file: Literal["Y", "N"]
    cb_person_cred_hist_length: int = Field(ge=0, le=100)


class Prediction(BaseModel):
    default_probability: float
    predicted_default: bool
    threshold: float
    model_version: str
    prediction_id: int | None = None
    request_id: str | None = None
    created_at: str | None = None
    model_run_id: str | None = None
