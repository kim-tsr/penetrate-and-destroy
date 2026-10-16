"""Modèles du type de challenge `dynamic_instance` et du suivi des instances."""

import datetime
import json

from CTFd.models import Challenges, db


class DynamicInstanceChallenge(Challenges):
    """Challenge dont chaque équipe (ou joueur) obtient une instance dédiée.

    `scenario` : référence OCI du scénario chall-manager (tag@digest). Vide =
    scénario générique PAD_GENERIC_SCENARIO paramétré par `instance_config`.
    `instance_config` : JSON (dict str -> str) transmis à chall-manager comme
    configuration `additional` du challenge (image, port, limites, ...).
    """

    __tablename__ = "pad_dynamic_instance_challenge"
    __mapper_args__ = {"polymorphic_identity": "dynamic_instance"}

    id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"), primary_key=True
    )
    scenario = db.Column(db.Text, nullable=True)
    instance_config = db.Column(db.Text, default="{}")
    timeout = db.Column(db.Integer, default=1800)  # TTL d'une instance (s)
    until = db.Column(db.DateTime, nullable=True)  # date butoir absolue (UTC)
    max_renewals = db.Column(db.Integer, default=3)
    per_instance_flag = db.Column(db.Boolean, default=False)
    destroy_on_solve = db.Column(db.Boolean, default=True)
    pool_min = db.Column(db.Integer, default=0)
    pool_max = db.Column(db.Integer, default=0)

    def __init__(self, *args, **kwargs):
        config = kwargs.pop("instance_config", None)
        super().__init__(**kwargs)
        self.set_config(config)

    def get_config(self):
        try:
            value = json.loads(self.instance_config or "{}")
        except ValueError:
            value = {}
        return value if isinstance(value, dict) else {}

    def set_config(self, config):
        if config is None:
            config = {}
        if isinstance(config, str):
            config = json.loads(config or "{}")
        if not isinstance(config, dict):
            raise ValueError("instance_config must be an object")
        self.instance_config = json.dumps(
            {str(k): str(v) for k, v in config.items()}, sort_keys=True
        )


class InstanceRecord(db.Model):
    """Vue locale des instances (quotas, renouvellements, métriques).

    chall-manager reste la source de vérité de l'existence d'une instance ;
    cette table sert aux contrôles côté CTFd et est réconciliée à la lecture.
    """

    __tablename__ = "pad_instances"
    __table_args__ = (
        db.UniqueConstraint("challenge_id", "source_id", name="uq_pad_instance"),
    )

    id = db.Column(db.Integer, primary_key=True)
    challenge_id = db.Column(
        db.Integer, db.ForeignKey("challenges.id", ondelete="CASCADE"), index=True
    )
    source_id = db.Column(db.String(64), index=True)
    owner_user_id = db.Column(
        db.Integer, db.ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)
    until = db.Column(db.DateTime, nullable=True, index=True)
    renewals = db.Column(db.Integer, default=0)
