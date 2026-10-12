
from sklearn.pipeline import Pipeline
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from .preprocessing import make_preprocessor


def make_pipeline(model):
    return Pipeline([("preprocessor", make_preprocessor()), ("model", model)])


def baseline_models():
    return {
        "Dummy": DummyClassifier(strategy="prior"),
        "Logistic": LogisticRegression(max_iter=1500, class_weight="balanced"),
        "Random Forest": RandomForestClassifier(
            n_estimators=150, random_state=42, n_jobs=-1
        ),
    }
