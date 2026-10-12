import numpy as np

def engineer_features(df):
    df = df.copy()

    # 1. handle implausible ages.
    df.loc[~df["person_age"].between(18, 100), "person_age"] = np.nan

    # 2. handle implausible employment lengths.
    invalid_employment = (df["person_emp_length"] < 0) | (
        df["person_emp_length"] > df["person_age"] - 16
    )

    df.loc[invalid_employment, "person_emp_length"] = np.nan

    # 3. create loan-to-income ratio.
    df["loan_to_income_ratio"] = df["loan_amnt"] / df["person_income"].replace(
        0, np.nan
    )

    # 4. create log-transformed features.
    df["log_income"] = np.log1p(df["person_income"].clip(lower=0))

    df["log_loan_amount"] = np.log1p(df["loan_amnt"].clip(lower=0))

    return df
