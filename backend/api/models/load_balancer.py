"""
EPOCH Load Balancer Backend - Predictive Failure Analytics System
ML-based load monitoring, failure prediction, and intelligent redistribution
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import numpy as np
from datetime import datetime
import random
from dataclasses import dataclass, asdict
from typing import List, Dict, Tuple
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for frontend communication

# ==================== DATA MODELS ====================

@dataclass
class LTLine:
    """LT Line data model"""
    line_id: str
    line_name: str
    current_load: float  # in kW
    capacity: float  # in kW
    load_percentage: float
    age_years: float
    material_quality: float  # 0-1 scale
    weather_stress: float  # 0-1 scale (0=ideal, 1=extreme)
    breakage_probability: float
    predicted_lifespan_years: float
    maintenance_score: float  # 0-1 scale

# ==================== GLOBAL STATE ====================

# Initialize LT lines with realistic data
lt_lines_data = [
    LTLine("LT001", "Line Alpha", 85, 100, 85.0, 8.5, 0.75, 0.6, 0, 0, 0.7),
    LTLine("LT002", "Line Beta", 65, 100, 65.0, 5.2, 0.85, 0.4, 0, 0, 0.8),
    LTLine("LT003", "Line Gamma", 92, 100, 92.0, 12.3, 0.60, 0.8, 0, 0, 0.5),
    LTLine("LT004", "Line Delta", 45, 100, 45.0, 3.1, 0.90, 0.3, 0, 0, 0.9),
    LTLine("LT005", "Line Epsilon", 78, 100, 78.0, 9.7, 0.70, 0.5, 0, 0, 0.65)
]

# Store initial state for reset functionality
initial_state = None

# ==================== ML PREDICTION MODELS ====================

class BreakagePredictionModel:
    """
    ML-based model to predict LT line breakage probability
    Uses multiple factors: load, age, material quality, weather stress
    """
    
    @staticmethod
    def predict(line: LTLine) -> float:
        """
        Predict breakage probability (0-100%)
        
        Factors:
        - Load percentage: Higher load = higher risk
        - Age: Older lines = higher risk
        - Material quality: Lower quality = higher risk
        - Weather stress: Extreme weather = higher risk
        - Maintenance score: Lower score = higher risk
        """
        # Normalize load factor (0-1)
        load_factor = min(line.load_percentage / 100, 1.5)  # Allow overload > 100%
        
        # Age factor (exponential decay)
        age_factor = 1 - np.exp(-line.age_years / 15)  # 15 years half-life
        
        # Material degradation factor
        material_factor = 1 - line.material_quality
        
        # Weather stress multiplier
        weather_multiplier = 1 + (line.weather_stress * 0.5)
        
        # Maintenance factor
        maintenance_factor = 1 - (line.maintenance_score * 0.3)
        
        # Combined probability calculation
        base_probability = (
            0.35 * load_factor +
            0.25 * age_factor +
            0.20 * material_factor +
            0.20 * maintenance_factor
        ) * weather_multiplier
        
        # Add non-linearity for critical overload
        if line.load_percentage > 90:
            overload_penalty = (line.load_percentage - 90) * 0.02
            base_probability += overload_penalty
        
        # Normalize to 0-100 range with realistic bounds
        probability = min(max(base_probability * 100, 0), 95)
        
        # Add small random variation for realism
        probability += np.random.uniform(-2, 2)
        
        return round(max(0, min(100, probability)), 2)


class LifespanPredictionModel:
    """
    ML-based model to predict remaining lifespan of LT lines
    Estimates years until critical degradation
    """
    
    @staticmethod
    def predict(line: LTLine) -> float:
        """
        Predict remaining lifespan in years
        
        Based on:
        - Current age and expected lifetime (25-30 years typical)
        - Load stress accumulation
        - Material quality degradation
        - Maintenance effectiveness
        """
        # Expected maximum lifespan based on material quality
        max_lifespan = 20 + (line.material_quality * 15)  # 20-35 years
        
        # Calculate wear rate based on load
        if line.load_percentage > 90:
            load_wear = 2.5  # Critical wear
        elif line.load_percentage > 70:
            load_wear = 1.5  # Accelerated wear
        else:
            load_wear = 1.0  # Normal wear
        
        # Weather impact on degradation
        weather_impact = 1 + (line.weather_stress * 0.5)
        
        # Maintenance extends lifespan
        maintenance_extension = line.maintenance_score * 5
        
        # Calculate effective age with wear factors
        effective_age = line.age_years * load_wear * weather_impact
        
        # Remaining years
        remaining = (max_lifespan - effective_age) + maintenance_extension
        
        # Add variability
        remaining += np.random.uniform(-1, 1)
        
        return round(max(0, remaining), 1)


class LoadRedistributionOptimizer:
    """
    ML-based optimizer for intelligent load redistribution
    Minimizes overall failure risk while balancing loads
    """
    
    @staticmethod
    def optimize(lines: List[LTLine]) -> Tuple[List[LTLine], Dict]:
        """
        Optimize load distribution across all lines
        
        Strategy:
        1. Identify overloaded lines (>90%)
        2. Identify underutilized lines (<70%)
        3. Transfer load to minimize total risk
        4. Ensure no line exceeds safe threshold
        
        Returns:
        - Optimized line configurations
        - Redistribution report
        """
        lines_copy = [LTLine(**asdict(line)) for line in lines]
        
        # Separate lines by load status
        overloaded = [l for l in lines_copy if l.load_percentage > 90]
        normal = [l for l in lines_copy if 70 <= l.load_percentage <= 90]
        underutilized = [l for l in lines_copy if l.load_percentage < 70]
        
        redistribution_log = []
        total_transferred = 0
        
        # Sort for optimal redistribution
        overloaded.sort(key=lambda x: x.breakage_probability, reverse=True)
        underutilized.sort(key=lambda x: x.capacity - x.current_load, reverse=True)
        
        # Redistribute from overloaded to underutilized
        for overload_line in overloaded:
            target_load = overload_line.capacity * 0.75  # Target 75% load
            excess_load = overload_line.current_load - target_load
            
            if excess_load <= 0:
                continue
            
            for under_line in underutilized:
                if excess_load <= 0:
                    break
                
                # Calculate safe transfer amount
                available_capacity = under_line.capacity * 0.85 - under_line.current_load
                
                if available_capacity > 5:  # Minimum 5 kW transfer
                    transfer_amount = min(excess_load, available_capacity)
                    
                    # Execute transfer
                    overload_line.current_load -= transfer_amount
                    under_line.current_load += transfer_amount
                    
                    # Update percentages
                    overload_line.load_percentage = (overload_line.current_load / overload_line.capacity) * 100
                    under_line.load_percentage = (under_line.current_load / under_line.capacity) * 100
                    
                    excess_load -= transfer_amount
                    total_transferred += transfer_amount
                    
                    redistribution_log.append({
                        'from': overload_line.line_id,
                        'to': under_line.line_id,
                        'amount': round(transfer_amount, 2),
                        'from_load_after': round(overload_line.load_percentage, 1),
                        'to_load_after': round(under_line.load_percentage, 1)
                    })
        
        # If still overloaded, distribute to normal lines
        for overload_line in overloaded:
            if overload_line.load_percentage > 85:
                target_load = overload_line.capacity * 0.80
                excess_load = overload_line.current_load - target_load
                
                for normal_line in normal:
                    if excess_load <= 0:
                        break
                    
                    available_capacity = normal_line.capacity * 0.88 - normal_line.current_load
                    
                    if available_capacity > 3:
                        transfer_amount = min(excess_load, available_capacity)
                        
                        overload_line.current_load -= transfer_amount
                        normal_line.current_load += transfer_amount
                        
                        overload_line.load_percentage = (overload_line.current_load / overload_line.capacity) * 100
                        normal_line.load_percentage = (normal_line.current_load / normal_line.capacity) * 100
                        
                        excess_load -= transfer_amount
                        total_transferred += transfer_amount
                        
                        redistribution_log.append({
                            'from': overload_line.line_id,
                            'to': normal_line.line_id,
                            'amount': round(transfer_amount, 2),
                            'from_load_after': round(overload_line.load_percentage, 1),
                            'to_load_after': round(normal_line.load_percentage, 1)
                        })
        
        report = {
            'total_transferred_kw': round(total_transferred, 2),
            'transfers_count': len(redistribution_log),
            'redistribution_details': redistribution_log,
            'timestamp': datetime.now().isoformat()
        }
        
        return lines_copy, report


# ==================== HELPER FUNCTIONS ====================

def update_predictions(lines: List[LTLine]):
    """Update ML predictions for all lines"""
    for line in lines:
        line.breakage_probability = BreakagePredictionModel.predict(line)
        line.predicted_lifespan_years = LifespanPredictionModel.predict(line)


def simulate_environmental_changes():
    """Simulate random environmental changes (weather, load variations)"""
    for line in lt_lines_data:
        # Small random load variation
        load_change = np.random.uniform(-3, 3)
        line.current_load = max(0, min(line.capacity * 1.2, line.current_load + load_change))
        line.load_percentage = (line.current_load / line.capacity) * 100
        
        # Weather stress variation
        line.weather_stress = max(0, min(1, line.weather_stress + np.random.uniform(-0.1, 0.1)))


def format_line_response(lines: List[LTLine]) -> Dict:
    """Format lines data for API response"""
    return {
        'lt_lines': [asdict(line) for line in lines],
        'timestamp': datetime.now().isoformat(),
        'total_lines': len(lines),
        'critical_lines': sum(1 for l in lines if l.load_percentage > 90),
        'average_load': round(np.mean([l.load_percentage for l in lines]), 2),
        'max_breakage_risk': round(max([l.breakage_probability for l in lines]), 2)
    }


# ==================== API ENDPOINTS ====================

@app.route('/health', methods=['GET'])
def health_check():
    """Backend health check"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'service': 'EPOCH Load Balancer Backend',
        'version': '1.0.0'
    })


@app.route('/api/lt-lines', methods=['GET'])
def get_lt_lines():
    """Get current LT lines data"""
    update_predictions(lt_lines_data)
    return jsonify(format_line_response(lt_lines_data))


@app.route('/get_load_data', methods=['GET'])
def get_load_data():
    """Get load data (legacy endpoint for compatibility)"""
    update_predictions(lt_lines_data)
    return jsonify(format_line_response(lt_lines_data))


@app.route('/predict_failure', methods=['POST'])
def predict_failure():
    """Predict failure probability for specific line or all lines"""
    data = request.get_json() or {}
    line_id = data.get('line_id')
    
    if line_id:
        line = next((l for l in lt_lines_data if l.line_id == line_id), None)
        if not line:
            return jsonify({'error': 'Line not found'}), 404
        
        probability = BreakagePredictionModel.predict(line)
        line.breakage_probability = probability
        
        return jsonify({
            'line_id': line_id,
            'line_name': line.line_name,
            'breakage_probability': probability,
            'risk_level': 'critical' if probability > 60 else 'warning' if probability > 30 else 'low',
            'timestamp': datetime.now().isoformat()
        })
    
    # Predict for all lines
    update_predictions(lt_lines_data)
    predictions = [{
        'line_id': line.line_id,
        'line_name': line.line_name,
        'breakage_probability': line.breakage_probability,
        'risk_level': 'critical' if line.breakage_probability > 60 else 'warning' if line.breakage_probability > 30 else 'low'
    } for line in lt_lines_data]
    
    return jsonify({
        'predictions': predictions,
        'timestamp': datetime.now().isoformat()
    })


@app.route('/lifespan_prediction', methods=['POST'])
def lifespan_prediction():
    """Predict remaining lifespan for lines"""
    data = request.get_json() or {}
    line_id = data.get('line_id')
    
    if line_id:
        line = next((l for l in lt_lines_data if l.line_id == line_id), None)
        if not line:
            return jsonify({'error': 'Line not found'}), 404
        
        lifespan = LifespanPredictionModel.predict(line)
        line.predicted_lifespan_years = lifespan
        
        return jsonify({
            'line_id': line_id,
            'line_name': line.line_name,
            'predicted_lifespan_years': lifespan,
            'current_age_years': line.age_years,
            'status': 'urgent' if lifespan < 3 else 'attention' if lifespan < 7 else 'good',
            'timestamp': datetime.now().isoformat()
        })
    
    # Predict for all lines
    predictions = []
    for line in lt_lines_data:
        lifespan = LifespanPredictionModel.predict(line)
        line.predicted_lifespan_years = lifespan
        predictions.append({
            'line_id': line.line_id,
            'line_name': line.line_name,
            'predicted_lifespan_years': lifespan,
            'current_age_years': line.age_years,
            'status': 'urgent' if lifespan < 3 else 'attention' if lifespan < 7 else 'good'
        })
    
    return jsonify({
        'lifespan_predictions': predictions,
        'timestamp': datetime.now().isoformat()
    })


@app.route('/redistribute_load', methods=['POST'])
def redistribute_load():
    """Intelligent load redistribution using ML optimizer"""
    global lt_lines_data
    
    data = request.get_json() or {}
    line_id = data.get('line_id')
    
    # Update predictions before redistribution
    update_predictions(lt_lines_data)
    
    # Store before state
    before_loads = [(l.line_id, l.load_percentage, l.breakage_probability) for l in lt_lines_data]
    
    # Perform optimization
    optimized_lines, report = LoadRedistributionOptimizer.optimize(lt_lines_data)
    
    # Update global state
    lt_lines_data = optimized_lines
    
    # Update predictions after redistribution
    update_predictions(lt_lines_data)
    
    # Calculate improvement
    before_avg_risk = np.mean([b[2] for b in before_loads])
    after_avg_risk = np.mean([l.breakage_probability for l in lt_lines_data])
    improvement = ((before_avg_risk - after_avg_risk) / before_avg_risk * 100) if before_avg_risk > 0 else 0
    
    response = format_line_response(lt_lines_data)
    response.update({
        'redistribution_report': report,
        'improvement_percentage': round(improvement, 2),
        'before_average_risk': round(before_avg_risk, 2),
        'after_average_risk': round(after_avg_risk, 2)
    })
    
    logger.info(f"Load redistribution completed: {report['transfers_count']} transfers, {improvement:.1f}% improvement")
    
    return jsonify(response)


@app.route('/api/redistribute', methods=['POST'])
def api_redistribute():
    """Simplified redistribution endpoint"""
    return redistribute_load()


@app.route('/reset_system', methods=['POST'])
def reset_system():
    """Reset system to initial state"""
    global lt_lines_data, initial_state
    
    # Reinitialize with fresh data
    lt_lines_data = [
        LTLine("LT001", "Line Alpha", 85, 100, 85.0, 8.5, 0.75, 0.6, 0, 0, 0.7),
        LTLine("LT002", "Line Beta", 65, 100, 65.0, 5.2, 0.85, 0.4, 0, 0, 0.8),
        LTLine("LT003", "Line Gamma", 92, 100, 92.0, 12.3, 0.60, 0.8, 0, 0, 0.5),
        LTLine("LT004", "Line Delta", 45, 100, 45.0, 3.1, 0.90, 0.3, 0, 0, 0.9),
        LTLine("LT005", "Line Epsilon", 78, 100, 78.0, 9.7, 0.70, 0.5, 0, 0, 0.65)
    ]
    
    update_predictions(lt_lines_data)
    
    logger.info("System reset to initial state")
    
    return jsonify({
        **format_line_response(lt_lines_data),
        'message': 'System reset successfully'
    })


@app.route('/alerts', methods=['GET'])
def get_alerts():
    """Get current system alerts"""
    alerts = []
    
    for line in lt_lines_data:
        # Overload alerts
        if line.load_percentage > 90:
            alerts.append({
                'type': 'critical',
                'category': 'overload',
                'line_id': line.line_id,
                'line_name': line.line_name,
                'message': f'{line.line_name} is critically overloaded at {line.load_percentage:.1f}%',
                'priority': 'high'
            })
        elif line.load_percentage > 80:
            alerts.append({
                'type': 'warning',
                'category': 'overload',
                'line_id': line.line_id,
                'line_name': line.line_name,
                'message': f'{line.line_name} approaching overload at {line.load_percentage:.1f}%',
                'priority': 'medium'
            })
        
        # Breakage risk alerts
        if line.breakage_probability > 60:
            alerts.append({
                'type': 'critical',
                'category': 'failure_risk',
                'line_id': line.line_id,
                'line_name': line.line_name,
                'message': f'{line.line_name} has high failure risk: {line.breakage_probability:.1f}%',
                'priority': 'high'
            })
        
        # Lifespan alerts
        if line.predicted_lifespan_years < 3:
            alerts.append({
                'type': 'critical',
                'category': 'lifespan',
                'line_id': line.line_id,
                'line_name': line.line_name,
                'message': f'{line.line_name} critically low lifespan: {line.predicted_lifespan_years:.1f} years',
                'priority': 'high'
            })
        elif line.predicted_lifespan_years < 7:
            alerts.append({
                'type': 'warning',
                'category': 'lifespan',
                'line_id': line.line_id,
                'line_name': line.line_name,
                'message': f'{line.line_name} needs attention: {line.predicted_lifespan_years:.1f} years remaining',
                'priority': 'medium'
            })
    
    return jsonify({
        'alerts': alerts,
        'total_alerts': len(alerts),
        'critical_count': sum(1 for a in alerts if a['type'] == 'critical'),
        'timestamp': datetime.now().isoformat()
    })


# ==================== STARTUP ====================

if __name__ == '__main__':
    # Initialize predictions on startup
    update_predictions(lt_lines_data)
    initial_state = [LTLine(**asdict(line)) for line in lt_lines_data]
    
    logger.info("=" * 60)
    logger.info("EPOCH Load Balancer Backend Starting...")
    logger.info("=" * 60)
    logger.info(f"Total LT Lines: {len(lt_lines_data)}")
    logger.info("ML Models Loaded:")
    logger.info("  - Breakage Prediction Model")
    logger.info("  - Lifespan Prediction Model")
    logger.info("  - Load Redistribution Optimizer")
    logger.info("=" * 60)
    
    # Run Flask server
    app.run(host='0.0.0.0', port=5000, debug=True)